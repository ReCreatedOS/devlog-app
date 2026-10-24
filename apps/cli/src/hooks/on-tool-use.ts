import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  createRoutedEntry,
  isTeamClone,
  loadConfig,
  localIso,
  redact,
  spawnBackgroundSync,
  teamForRepo,
  teamOfEntry,
  writeEntry,
} from '@devlog/core'
import type { DevlogConfig, Entry, EntryDraft } from '@devlog/core'
import {
  alreadyLogged,
  findLogged,
  git,
  marker,
  note,
  readHookPayload,
  repoInfo,
  runHook,
  truncate,
} from './shared.js'

/**
 * PostToolUse hook'u — Bash çağrılarından commit ve deploy olaylarını yakalar.
 *
 * Neden özellikle bunlar: commit gövdeleri ve deploy anları, projede detayı
 * BAŞKA HİÇBİR YERDE tutulmayan bilgiler. Seyir defterinin kuruluş gerekçesi
 * tam olarak bu boşluktu.
 */

/**
 * Komut KONUMUNA çapa.
 *
 * `\bgit commit\b` yetmiyor: bu metin bir echo dizesinin, grep deseninin ya da
 * JSON gövdesinin içinde de geçer ve hook o zaman ilgisiz bir HEAD'i kaydeder.
 * (Canlı yakalandı: `echo '{"command":"git commit -F -"}' | …` çağrısı, cwd'deki
 * bambaşka bir merge commit'ini deftere yazdı.) Bu yüzden eşleşme yalnız
 * komutun başında ya da bir kabuk ayıracından sonra geçerli sayılıyor —
 * tırnak içindeki metin ayıraç değildir, dolayısıyla eşleşmez.
 */
const COMMAND_START = String.raw`(?:^|[;&|(\n]|&&|\|\|)\s*(?:sudo\s+)?(?:[A-Z_]+=\S+\s+)*`

const COMMIT_RE = new RegExp(`${COMMAND_START}git\\s+(?:-C\\s+\\S+\\s+)?commit\\b`)
const GIT_DIR_RE = new RegExp(`${COMMAND_START}git\\s+-C\\s+(\\S+)`)
const CD_RE = new RegExp(`${COMMAND_START}cd\\s+(\\S+)`)

function unquote(value: string): string {
  return value.replace(/^['"]|['"]$/g, '')
}

/**
 * Commit'in gerçekte hangi depoda atıldığını bulur.
 *
 * Hook'a gelen `cwd` OTURUMUN dizinidir, komut içindeki `cd`'den SONRAKİ dizin
 * değil. `cd paket && git commit` son derece yaygın bir kalıp ve bu fark
 * yüzünden hook, bambaşka bir deponun HEAD'ini kaydediyordu (canlı yaşandı:
 * devlog'a atılan commit yerine oturum dizinindeki başka bir deponun merge commit'i deftere düştü).
 */
function resolveRepoDir(command: string, sessionCwd: string): string {
  const explicit = GIT_DIR_RE.exec(command)?.[1]
  if (explicit) return path.resolve(sessionCwd, unquote(explicit))
  const changed = CD_RE.exec(command)?.[1]
  if (changed) return path.resolve(sessionCwd, unquote(changed))
  return sessionCwd
}

const DEPLOY_PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: new RegExp(`${COMMAND_START}(?:npx\\s+)?wrangler\\s+(?:pages\\s+)?deploy\\b`), label: 'Cloudflare' },
  { re: new RegExp(`${COMMAND_START}(?:npx\\s+)?supabase\\s+functions\\s+deploy\\b`), label: 'Supabase Functions' },
  { re: new RegExp(`${COMMAND_START}(?:npx\\s+)?supabase\\s+db\\s+push\\b`), label: 'Supabase DB' },
  { re: new RegExp(`${COMMAND_START}(?:pnpm|npm|yarn)\\s+(?:run\\s+)?deploy(?::\\S+)?\\b`), label: 'paket script' },
  { re: new RegExp(`${COMMAND_START}vercel\\s+(?:--prod|deploy)\\b`), label: 'Vercel' },
  { re: new RegExp(`${COMMAND_START}fly\\s+deploy\\b`), label: 'Fly.io' },
]

function bashOutput(response: unknown): string {
  if (typeof response === 'string') return response
  if (response && typeof response === 'object') {
    const record = response as Record<string, unknown>
    const parts = [record.stdout, record.stderr].filter((v): v is string => typeof v === 'string')
    if (parts.length > 0) return parts.join('\n')
  }
  return ''
}

/**
 * Takım kaydıysa eşitlemeyi kopuk bir sürece bırak — hook ağ beklemez.
 * `devlog.mjs` bu hook'la aynı `dist/` dizininde derleniyor.
 */
function syncIfTeam(config: DevlogConfig, entry: Pick<Entry, 'sourceId'>): void {
  const team = teamOfEntry(config, entry)
  if (!team) return
  spawnBackgroundSync(fileURLToPath(new URL('./devlog.mjs', import.meta.url)), team.id)
  note(`takıma gidiyor: ${team.id}`)
}

/**
 * Bu kod deposu bir takıma eşlenmişse kayıt oraya gider. Eşleme yalnız
 * commit/deploy içindir; oturum özetleri promptları taşıdığı için asla.
 */
async function routeDraft(config: DevlogConfig, repoRoot: string | undefined, draft: EntryDraft): Promise<EntryDraft> {
  if (!repoRoot) return draft
  const team = await teamForRepo(config, repoRoot)
  if (!team) return draft
  // Klon yoksa commit kaydını kaybetmek yerine kişisel vault'a düş.
  if (!(await isTeamClone(team))) {
    note(`takım klonu yok (${team.root}); kayıt kişisel vault'a yazıldı`)
    return draft
  }
  return { ...draft, team: team.id }
}

/** Commit bu kadar saniyeden eskiyse komut yeni bir commit üretmemiştir. */
const FRESH_COMMIT_SECONDS = 120

async function logCommit(cwd: string, amend: boolean): Promise<void> {
  // `tool_response`ı ayrıştırmak yerine git'e soruyoruz: çıktı biçimi
  // sürümden sürüme değişir, HEAD ise kesindir.
  const raw = git(cwd, ['log', '-1', '--format=%H%x00%h%x00%aI%x00%cI%x00%s%x00%b'])
  if (!raw) return
  const [sha, shortSha, authoredAt, committedAt, subject, body] = raw.split('\0')
  if (!sha || !shortSha || !subject) return

  // Başarısız commit (pre-commit hook reddi, "nothing to commit") HEAD'i
  // değiştirmez; o zaman HEAD bambaşka, eski bir commit'tir ve kaydedilmemeli.
  // Amend de committer tarihini tazeler, yani bu kontrolden geçer.
  const ageSeconds = (Date.now() - Date.parse(committedAt ?? '')) / 1000
  if (!(ageSeconds < FRESH_COMMIT_SECONDS)) {
    note(`HEAD yeni değil (${shortSha}); commit başarısız olmuş olabilir — atlandı`)
    return
  }

  if (await alreadyLogged(sha)) {
    note(`commit zaten kayıtlı: ${shortSha}`)
    return
  }

  const repo = repoInfo(cwd)
  const files = (git(cwd, ['show', '--pretty=format:', '--name-only', 'HEAD']) ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

  const sections = [
    body?.trim() ? body.trim() : '_(commit gövdesi yok)_',
    '',
    `**Değişen dosyalar (${files.length}):**`,
    ...files.slice(0, 25).map((file) => `- \`${file}\``),
    ...(files.length > 25 ? [`- …ve ${files.length - 25} dosya daha`] : []),
    '',
    marker('commit', sha),
  ]

  const draft: EntryDraft = {
    title: truncate(subject, 120),
    type: 'commit',
    body: redact(sections.join('\n')).text,
    occurred_at: authoredAt,
    project: repo?.name,
    tags: [repo?.name, repo?.branch].filter((v): v is string => Boolean(v)),
    refs: { commits: [shortSha], files: files.slice(0, 25) },
  }

  const config = await loadConfig()

  // Amend SHA'yı değiştirir; SHA'ya göre tekilleştirme ikinci bir kayıt açardı.
  // Önceki commit'in kaydı varsa onu yeni hâliyle güncelle.
  const previousSha = amend ? git(cwd, ['rev-parse', 'HEAD@{1}']) : null
  const previous = previousSha ? await findLogged(marker('commit', previousSha)) : null
  if (previous) {
    const { body: _b, path: _p, sourceId: _s, readOnly: _r, derived: _d, outboundLinks: _o, ...frontmatter } =
      previous
    await writeEntry(
      config.vaultRoot,
      {
        ...frontmatter,
        title: redact(draft.title).text,
        occurred_at: draft.occurred_at ?? frontmatter.occurred_at,
        refs: draft.refs,
        updated_at: localIso(),
      },
      draft.body,
      previous.path,
    )
    note(`amend: ${previous.id} güncellendi → ${shortSha}`)
    syncIfTeam(config, previous)
    return
  }

  const { entry } = await createRoutedEntry(config, await routeDraft(config, repo?.root, draft))
  note(`commit kaydedildi: ${shortSha} → ${entry.id}`)
  syncIfTeam(config, entry)
}

async function logDeploy(cwd: string, command: string, response: unknown): Promise<void> {
  const matched = DEPLOY_PATTERNS.find((pattern) => pattern.re.test(command))
  if (!matched) return

  // Aynı komut kısa aralıkla iki kez çalışırsa (yeniden deneme) tek kayıt.
  // Parmak izi MASKELİ komuttan: gövdeye maskeli hâli yazılıyor, ham hâliyle
  // aranırsa sır içeren komutlar hiç eşleşmez ve her seferinde yeniden kaydedilir.
  const safeCommand = redact(command).text
  const fingerprint = `deploy:${truncate(safeCommand, 120)}`
  if (await alreadyLogged(fingerprint)) return

  const repo = repoInfo(cwd)
  // Önce maskele, sonra kes: kesmek bir özel anahtarın BEGIN satırını atarsa
  // desen artık eşleşmez ve anahtarın gövdesi deftere düşer.
  const output = redact(bashOutput(response)).text
  const tail = output.split('\n').slice(-20).join('\n').trim()

  const draft: EntryDraft = {
    title: truncate(`Deploy (${matched.label}): ${safeCommand}`, 120),
    type: 'deploy',
    status: 'done',
    // Deploy çıktısı imzalı URL, hesap kimliği ve token taşıyabilir.
    body: redact(
      [
        '```sh',
        safeCommand,
        '```',
        '',
        tail ? `**Çıktı (son satırlar):**\n\n\`\`\`\n${tail}\n\`\`\`` : '_(çıktı yok)_',
        '',
        marker('fingerprint', fingerprint),
      ].join('\n'),
    ).text,
    project: repo?.name,
    tags: [repo?.name, repo?.branch, 'deploy'].filter((v): v is string => Boolean(v)),
  }

  const config = await loadConfig()
  const { entry } = await createRoutedEntry(config, await routeDraft(config, repo?.root, draft))
  note(`deploy kaydedildi → ${entry.id}`)
  syncIfTeam(config, entry)
}

runHook(async () => {
  if (process.env['DEVLOG_HOOKS'] === 'off') return

  const payload = await readHookPayload()
  if (payload.tool_name !== 'Bash') return

  const command = typeof payload.tool_input?.['command'] === 'string' ? payload.tool_input['command'] : ''
  if (!command) return
  const cwd = payload.cwd ?? process.cwd()

  if (COMMIT_RE.test(command)) {
    await logCommit(resolveRepoDir(command, cwd), /\s--amend\b/.test(command))
    return
  }
  await logDeploy(resolveRepoDir(command, cwd), command, payload.tool_response)
})
