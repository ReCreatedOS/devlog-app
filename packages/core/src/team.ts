import { execFile, spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { activeTeams, configPath, expandHome, TEAM_ID_RE, type DevlogConfig, type TeamConfig } from './config.js'
import { slugify } from './fold.js'
import { parseDocument } from './frontmatter.js'
import { scanSecrets } from './redact.js'
import type { Entry, EntryDraft } from './types.js'
import { createEntry, ensureVault } from './vault.js'

/**
 * Takım vault'u eşitlemesi — sunucusuz, yalnız git.
 *
 * Model: her kişi YALNIZ kendi kayıtlarını yazar (`author`), kayıt başına tek
 * dosya. İki kişi aynı yola hiç dokunmadığı için rebase her zaman temiz geçer;
 * çakışma çözümü diye bir şey yoktur, olmamalıdır.
 *
 * Eşitleme idempotent bir "kendini toparla" adımıdır: yazma yolu yalnız diske
 * yazar, `syncTeam` o an commit'lenmemiş KENDİ dosyalarını toplar, uzaktakini
 * alır, kendisininkini iter. Push çevrimdışıyken düşerse bir sonraki eşitleme
 * kaldığı yerden devam eder — kuyruk yok, kaybolacak bir şey yok.
 */

interface GitResult {
  ok: boolean
  /** Ham çıktı — `-z` ve porcelain biçimlerinde baştaki boşluk anlamlı, kırpılmaz. */
  stdout: string
  stderr: string
}

/** Ağ işlemleri bunu aşarsa vazgeçilir; hook'lar ve MCP asılı kalmamalı. */
const NETWORK_TIMEOUT_MS = 25_000
const LOCAL_TIMEOUT_MS = 15_000

function runGit(cwd: string, args: string[], timeout = LOCAL_TIMEOUT_MS): Promise<GitResult> {
  return new Promise((resolve) => {
    execFile(
      'git',
      ['-c', 'core.quotepath=off', ...args],
      {
        cwd,
        timeout,
        maxBuffer: 16 * 1024 * 1024,
        windowsHide: true,
        env: {
          ...process.env,
          // Arka planda çalışıyoruz: bir parola/host-key sorusu süreci sonsuza
          // dek bekletir ve kilidi tutar. Soru soramıyorsak hata verelim.
          GIT_TERMINAL_PROMPT: '0',
          GIT_SSH_COMMAND: process.env['GIT_SSH_COMMAND'] ?? 'ssh -o BatchMode=yes',
        },
      },
      (error, stdout, stderr) => {
        // git hiç kurulu değilse (taze bir Windows, CLT'siz bir Mac) stderr boş
        // kalır ve kullanıcı yalnız "başarısız" görürdü.
        const missing = (error as NodeJS.ErrnoException | null)?.code === 'ENOENT'
        resolve({
          ok: !error,
          stdout: String(stdout),
          stderr: missing ? 'git bulunamadı — Git kurulu olmalı (https://git-scm.com)' : String(stderr).trim(),
        })
      },
    )
  })
}

/** git'in hata çıktısının kullanıcıya gösterilecek kısmı. */
function gitError(step: string, result: GitResult): string {
  const lines = result.stderr.split('\n').map((line) => line.trim()).filter(Boolean)
  const useful = lines.filter((line) => !line.startsWith('hint:')).slice(-2).join(' · ')
  return `${step}: ${useful || 'git başarısız oldu'}`
}

// ── Kilit ────────────────────────────────────────────────────────────────────
//
// Masaüstü, MCP sunucusu ve hook'un arka plan süreci aynı klonda git
// çalıştırabilir. İki eşzamanlı rebase/commit `index.lock` ile patlar ya da
// daha kötüsü yarım bir rebase bırakır. `mkdir` atomiktir; kilit dizini.

const STALE_LOCK_MS = 180_000

function stateDir(): string {
  return path.join(path.dirname(configPath()), 'sync')
}

async function acquireLock(teamId: string, waitMs: number): Promise<(() => Promise<void>) | null> {
  const dir = path.join(stateDir(), `${teamId}.lock`)
  await fs.mkdir(path.dirname(dir), { recursive: true })
  const deadline = Date.now() + waitMs
  for (;;) {
    try {
      await fs.mkdir(dir)
      return () => fs.rm(dir, { recursive: true, force: true })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }
    try {
      // Çöken bir sürecin kilidi sonsuza dek eşitlemeyi durdurmasın.
      if (Date.now() - (await fs.stat(dir)).mtimeMs > STALE_LOCK_MS) {
        await fs.rm(dir, { recursive: true, force: true })
        continue
      }
    } catch {
      continue
    }
    if (Date.now() >= deadline) return null
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
}

// ── Durum dosyası ────────────────────────────────────────────────────────────

export interface TeamSyncResult {
  team: string
  ok: boolean
  /** Eşitlemenin bittiği an (ISO). */
  at: string
  /** Bu turda commit'lenen kendi dosyalarım. */
  committed: number
  /** Uzaktan alınan commit sayısı. */
  pulled: number
  /** İtilen commit sayısı. */
  pushed: number
  /**
   * Sır taşıdığı için itilmeyen dosyalar. Maskelemiyoruz, BLOKLUYORUZ: takım
   * deposuna giden şey geri alınamaz (fork'lar, klonlar, GitHub önbelleği).
   */
  blocked: Array<{ path: string; found: string[] }>
  /** Yerelde değişmiş ama başkasına ait dosyalar — commit'lenmez. */
  foreign: string[]
  /** Uzaktan yeni gelen kayıt dosyaları (vault köküne göre). */
  arrived: string[]
  /** Henüz itilmemiş yerel commit sayısı — çevrimdışıyken biriken iş. */
  ahead: number
  error?: string
  /** Başka bir süreç o an eşitliyordu. */
  skipped?: 'busy'
}

function statePath(teamId: string): string {
  return path.join(stateDir(), `${teamId}.json`)
}

export async function readSyncState(teamId: string): Promise<TeamSyncResult | null> {
  try {
    return JSON.parse(await fs.readFile(statePath(teamId), 'utf8')) as TeamSyncResult
  } catch {
    return null
  }
}

async function writeSyncState(result: TeamSyncResult): Promise<void> {
  await fs.mkdir(stateDir(), { recursive: true })
  await fs.writeFile(statePath(result.team), `${JSON.stringify(result, null, 2)}\n`, 'utf8')
}

// ── Commit'lenecek dosyaların seçimi ─────────────────────────────────────────

/** Takımca paylaşılan rehber dosyaları — yalnız ilk kez (izlenmiyorken) eklenir. */
const GUIDE_FILES = new Set(['CLAUDE.md', 'AGENTS.md', 'taxonomy.yaml', '.gitignore'])

interface Change {
  path: string
  code: string
}

/** `git status --porcelain -z` çıktısını ayrıştırır (yeniden adlandırmalar iki yol taşır). */
function parsePorcelain(raw: string): Change[] {
  const parts = raw.split('\0')
  const changes: Change[] = []
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index] as string
    if (part.length < 4) continue
    const code = part.slice(0, 2)
    changes.push({ code, path: part.slice(3) })
    if (code.includes('R') || code.includes('C')) index += 1
  }
  return changes
}

function authorOf(raw: string): string | undefined {
  try {
    const author = parseDocument(raw).data.author
    return typeof author === 'string' ? author : undefined
  } catch {
    return undefined
  }
}

function titleOf(raw: string): string | undefined {
  try {
    const title = parseDocument(raw).data.title
    return typeof title === 'string' ? title : undefined
  } catch {
    return undefined
  }
}

interface Selection {
  files: string[]
  titles: string[]
  blocked: TeamSyncResult['blocked']
  foreign: string[]
}

async function selectOwnChanges(team: TeamConfig): Promise<Selection> {
  const status = await runGit(team.root, ['status', '--porcelain', '-z', '--untracked-files=all'])
  const selection: Selection = { files: [], titles: [], blocked: [], foreign: [] }
  if (!status.ok) return selection

  for (const change of parsePorcelain(status.stdout)) {
    const rel = change.path
    const isEntry = rel.startsWith('entries/') && rel.endsWith('.md')
    const isGuide = GUIDE_FILES.has(rel)
    if (!isEntry && !isGuide) continue

    if (change.code.includes('D')) {
      // Silme de bir yazmadır: yalnız kendi kaydımı silebilirim.
      if (!isEntry) continue
      const before = await runGit(team.root, ['show', `HEAD:${rel}`])
      if (before.ok && authorOf(before.stdout) === team.author) selection.files.push(rel)
      else selection.foreign.push(rel)
      continue
    }

    let raw: string
    try {
      raw = await fs.readFile(path.join(team.root, rel), 'utf8')
    } catch {
      continue
    }
    if (isGuide) {
      // Rehber dosyaları ortaktır; izlenen bir rehberi yerelde değiştirmek
      // herkesin dosyasını değiştirmek demek. Yalnız ilk kurulumda eklenir.
      if (change.code !== '??') {
        selection.foreign.push(rel)
        continue
      }
    } else if (authorOf(raw) !== team.author) {
      selection.foreign.push(rel)
      continue
    }

    const found = scanSecrets(raw)
    if (found.length > 0) {
      selection.blocked.push({ path: rel, found })
      continue
    }
    selection.files.push(rel)
    if (isEntry) selection.titles.push(titleOf(raw) ?? path.basename(rel, '.md'))
  }
  return selection
}

function commitMessage(team: TeamConfig, titles: string[]): string {
  if (titles.length === 0) return `devlog(${team.author}): vault kurulumu`
  const [first] = titles
  const more = titles.length > 1 ? ` (+${titles.length - 1})` : ''
  return `devlog(${team.author}): ${first}${more}`
}

// ── Uzak dal ─────────────────────────────────────────────────────────────────

async function hasHead(root: string): Promise<boolean> {
  return (await runGit(root, ['rev-parse', '--verify', '-q', 'HEAD'])).ok
}

async function currentBranch(root: string): Promise<string> {
  return (await runGit(root, ['symbolic-ref', '--short', 'HEAD'])).stdout.trim() || 'main'
}

async function remoteBranch(root: string, branch: string): Promise<string | null> {
  for (const candidate of [branch, 'main', 'master']) {
    if ((await runGit(root, ['rev-parse', '--verify', '-q', `refs/remotes/origin/${candidate}`])).ok) {
      return candidate
    }
  }
  return null
}

/**
 * Boş bir depodan klonlanmış (henüz commit'siz) bir kopya, uzakta biri ilk
 * commit'i atınca ona oturtulur. Yerel izlenmeyen kayıtlar yerinde kalır ve
 * aynı turda commit'lenir.
 */
async function adoptRemoteIfUnborn(root: string): Promise<void> {
  if (await hasHead(root)) return
  const branch = await remoteBranch(root, await currentBranch(root))
  if (!branch) return
  await runGit(root, ['symbolic-ref', 'HEAD', `refs/heads/${branch}`])
  await runGit(root, ['reset', '-q', `origin/${branch}`])
  // Yerelde ensureVault'un yazdığı rehberler uzaktakilerle değişsin.
  await runGit(root, ['checkout', '-q', '--', '.'])
}

async function count(root: string, range: string): Promise<number> {
  const result = await runGit(root, ['rev-list', '--count', range])
  return result.ok ? Number.parseInt(result.stdout.trim(), 10) || 0 : 0
}

async function arrivedFiles(root: string, from: string): Promise<string[]> {
  const result = await runGit(root, ['diff', '--name-only', '--diff-filter=A', from, 'HEAD', '--', 'entries'])
  return result.ok ? result.stdout.split('\n').map((line) => line.trim()).filter(Boolean) : []
}

const PUSH_REJECTED_RE = /rejected|fetch first|non-fast-forward|failed to push/i

// ── Eşitleme ─────────────────────────────────────────────────────────────────

export interface SyncOptions {
  /** Başka bir süreç eşitliyorsa en fazla bu kadar bekle (ms). 0 → hemen vazgeç. */
  wait?: number
  /** `false` → yalnız al, itme. */
  push?: boolean
}

export async function isTeamClone(team: TeamConfig): Promise<boolean> {
  try {
    await fs.access(path.join(team.root, '.git'))
    return true
  } catch {
    return false
  }
}

export async function syncTeam(team: TeamConfig, options: SyncOptions = {}): Promise<TeamSyncResult> {
  const result: TeamSyncResult = {
    team: team.id,
    ok: false,
    at: new Date().toISOString(),
    committed: 0,
    pulled: 0,
    pushed: 0,
    blocked: [],
    foreign: [],
    arrived: [],
    ahead: 0,
  }

  if (!(await isTeamClone(team))) {
    result.error = `takım klonu yok: ${team.root} — \`devlog team add\` ile kur`
    await writeSyncState(result)
    return result
  }

  const release = await acquireLock(team.id, options.wait ?? 0)
  if (!release) return { ...result, ok: true, skipped: 'busy' }

  try {
    const fetched = await runGit(team.root, ['fetch', '--quiet', '--prune', 'origin'], NETWORK_TIMEOUT_MS)
    if (fetched.ok) await adoptRemoteIfUnborn(team.root)

    // 1. Kendi değişikliklerim → commit. Çevrimdışıyken de yapılır: yerel
    //    commit, sonraki turda itilecek işin kaydıdır.
    const selection = await selectOwnChanges(team)
    result.blocked = selection.blocked
    result.foreign = selection.foreign
    if (selection.files.length > 0) {
      const added = await runGit(team.root, ['add', '-A', '--', ...selection.files])
      if (!added.ok) throw new Error(gitError('git add', added))
      // Yol listesiyle commit: kullanıcının elle sahnelediği başka bir şey
      // (yabancı dosya, sırlı kayıt) bu commit'e sızmasın.
      const committed = await runGit(team.root, [
        'commit',
        '-q',
        '-m',
        commitMessage(team, selection.titles),
        '--',
        ...selection.files,
      ])
      if (!committed.ok) throw new Error(gitError('git commit', committed))
      result.committed = selection.files.length
    }

    if (!fetched.ok) throw new Error(gitError('git fetch (çevrimdışı mı?)', fetched))
    if (!(await hasHead(team.root))) {
      result.ok = true
      return result
    }

    // 2. Upstream: ilk turda uzakta dal yoksa ilk push onu kurar.
    const branch = await currentBranch(team.root)
    let upstream = (await runGit(team.root, ['rev-parse', '--abbrev-ref', '@{u}'])).ok
    if (!upstream && (await remoteBranch(team.root, branch)) === branch) {
      upstream = (await runGit(team.root, ['branch', '-q', `--set-upstream-to=origin/${branch}`])).ok
    }

    // 3. Al → it. Push reddedilirse (biri araya girdi) yeniden al ve dene.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (upstream) {
        const behind = await count(team.root, 'HEAD..@{u}')
        if (behind > 0) {
          const before = (await runGit(team.root, ['rev-parse', 'HEAD'])).stdout.trim()
          const rebased = await runGit(team.root, ['rebase', '-q', '--autostash', '@{u}'], NETWORK_TIMEOUT_MS)
          if (!rebased.ok) {
            await runGit(team.root, ['rebase', '--abort'])
            throw new Error(gitError('rebase', rebased))
          }
          result.pulled += behind
          result.arrived.push(...(await arrivedFiles(team.root, before)))
        }
      }

      const ahead = upstream ? await count(team.root, '@{u}..HEAD') : await count(team.root, 'HEAD')
      if (options.push === false || ahead === 0) break

      const pushArgs = upstream ? ['push', '-q', 'origin', 'HEAD'] : ['push', '-q', '-u', 'origin', 'HEAD']
      const pushed = await runGit(team.root, pushArgs, NETWORK_TIMEOUT_MS)
      if (pushed.ok) {
        result.pushed += ahead
        upstream = true
        break
      }
      if (!PUSH_REJECTED_RE.test(pushed.stderr) || attempt === 2) throw new Error(gitError('git push', pushed))
      const refetched = await runGit(team.root, ['fetch', '--quiet', 'origin'], NETWORK_TIMEOUT_MS)
      if (!refetched.ok) throw new Error(gitError('git fetch', refetched))
    }

    result.ok = true
    return result
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error)
    return result
  } finally {
    if (await hasHead(team.root)) {
      const tracked = (await runGit(team.root, ['rev-parse', '--abbrev-ref', '@{u}'])).ok
      result.ahead = await count(team.root, tracked ? '@{u}..HEAD' : 'HEAD')
    }
    result.at = new Date().toISOString()
    await writeSyncState(result).catch(() => undefined)
    await release()
  }
}

/**
 * Son eşitleme `maxAgeMs`'ten eskiyse eşitler, en fazla `budgetMs` bekler.
 * MCP aramaları bunu kullanır: ajan "takım ne yaptı" diye sorduğunda bayat
 * bir kopyaya bakmasın, ama ağ yavaşsa arama da kilitlenmesin.
 */
export async function syncIfStale(team: TeamConfig, maxAgeMs: number, budgetMs: number): Promise<void> {
  const last = await readSyncState(team.id)
  if (last && Date.now() - Date.parse(last.at) < maxAgeMs) return
  await Promise.race([
    syncTeam(team),
    new Promise((resolve) => setTimeout(resolve, budgetMs)),
  ])
}

/**
 * Hook'lar beklemez: eşitlemeyi ayrı, ebeveynden kopuk bir sürece bırakır.
 * `cliScript` derlenmiş `devlog.mjs`'in yoludur.
 */
export function spawnBackgroundSync(cliScript: string, teamId: string): void {
  const child = spawn(process.execPath, [cliScript, 'sync', teamId, '--wait', '--quiet'], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  })
  child.unref()
}

// ── Kurulum ──────────────────────────────────────────────────────────────────

/**
 * Takım deposunu klonlar ve vault iskeletini kurar. Uzak depo boşsa ilk
 * eşitleme rehber dosyalarını commit'leyip dalı oluşturur.
 */
export async function cloneTeam(remote: string, root: string): Promise<void> {
  const target = expandHome(root)
  try {
    await fs.access(path.join(target, '.git'))
    await ensureVault(target)
    return
  } catch {
    // klon yok — devam
  }
  try {
    if ((await fs.readdir(target)).length > 0) {
      throw new Error(`${target} boş değil ve bir git deposu değil; başka bir yol seç`)
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  await fs.mkdir(path.dirname(target), { recursive: true })
  const cloned = await runGit(path.dirname(target), ['clone', '-q', remote, target], 120_000)
  if (!cloned.ok) {
    const auth = /auth|denied|not found|could not read|403|404|terminal prompts disabled/i.test(cloned.stderr)
    throw new Error(
      gitError('git clone', cloned) +
        (auth
          ? ' — repoya davetli olduğundan ve git\'in GitHub\'a giriş yaptığından emin ol ' +
            '(terminalde: gh auth login && gh auth setup-git)'
          : ''),
    )
  }
  await ensureVault(target)
}

export interface JoinTeamInput {
  remote: string
  /** Verilmezse işletim sistemi kullanıcı adı. */
  author?: string
  /** Verilmezse depo adından türetilir (`devlog-ekip` → `ekip`). */
  id?: string
  label?: string
  root?: string
  repos?: string[]
}

const AUTHOR_RE = /^[a-z0-9][a-z0-9-]{0,39}$/

/**
 * Takıma katılmanın TEK yolu (CLI `team add` ve masaüstü Ayarlar aynı kodu
 * çalıştırır): doğrula, klonla, takım kaydını üret. Config'e yazmak çağıranın
 * işi — masaüstü ayarı hemen uygulamak zorunda, CLI değil.
 */
export async function prepareTeam(config: DevlogConfig, input: JoinTeamInput): Promise<TeamConfig> {
  const remote = input.remote.trim()
  if (!remote) throw new Error('Depo adresi gerekli')
  const repoName = normalizeRemote(remote)?.split('/')[1]
  const id = (input.id ?? slugify(repoName?.replace(/^devlog-/, '') ?? '')).toLowerCase()
  if (!TEAM_ID_RE.test(id)) throw new Error(`Takım kimliği türetilemedi (${id || 'boş'}); adı elle ver`)

  const existing = (config.teams ?? []).find((team) => team.id === id)
  // Yazar adı kayıt id'lerine ve commit mesajlarına girer: kısa ve kalıcı.
  const author = slugify(input.author?.trim() || existing?.author || os.userInfo().username)
  if (!AUTHOR_RE.test(author)) throw new Error(`Geçersiz yazar adı: ${author}`)

  const root = input.root
    ? expandHome(input.root)
    : (existing?.root ?? path.join(path.dirname(config.vaultRoot), `devlog-${id}`))
  if (path.resolve(root) === path.resolve(config.vaultRoot)) {
    throw new Error('Takım klonu kişisel vault ile aynı yerde olamaz — kişisel vault hiçbir zaman itilmez')
  }

  await cloneTeam(remote, root)
  return {
    id,
    label: input.label?.trim() || existing?.label || repoName || id,
    root,
    remote,
    author,
    repos: input.repos ?? existing?.repos,
    enabled: existing?.enabled,
  }
}

/** Takımı listeye ekler ya da aynı id'liyi günceller. */
export function withTeam(config: DevlogConfig, team: TeamConfig): DevlogConfig {
  return { ...config, teams: [...(config.teams ?? []).filter((item) => item.id !== team.id), team] }
}

/**
 * Takımdan ayrıl: yalnız config'ten düşer. Klon diskte kalır — içinde
 * itilmemiş kendi kayıtların olabilir, sessizce silmek kayıp olurdu.
 */
export function withoutTeam(config: DevlogConfig, id: string): DevlogConfig {
  const teams = (config.teams ?? []).filter((team) => team.id !== id)
  return { ...config, teams: teams.length > 0 ? teams : undefined }
}

// ── Yönlendirme ──────────────────────────────────────────────────────────────

export function findTeam(config: DevlogConfig, id: string): TeamConfig | undefined {
  const key = id.trim().toLowerCase()
  return (config.teams ?? []).find((team) => team.id === key || team.label.toLowerCase() === key)
}

/** `git@github.com:Org/Repo.git`, `https://github.com/Org/Repo` → `org/repo` */
export function normalizeRemote(url: string): string | null {
  const match = /[:/]([^/:]+)\/([^/]+?)(?:\.git)?\/?$/.exec(url.trim())
  return match ? `${match[1]}/${match[2]}`.toLowerCase() : null
}

/**
 * Bir kod deposunun commit/deploy kayıtları hangi takıma gider.
 * Eşleşme: depo adı, mutlak yol ya da `sahip/depo` (origin'den).
 */
export async function teamForRepo(config: DevlogConfig, repoRoot: string): Promise<TeamConfig | undefined> {
  const teams = activeTeams(config).filter((team) => team.repos?.length)
  if (teams.length === 0) return undefined
  const name = path.basename(repoRoot).toLowerCase()
  let remote: string | null | undefined
  for (const team of teams) {
    for (const pattern of team.repos ?? []) {
      const value = pattern.trim()
      if (!value) continue
      if (value.startsWith('/') || value.startsWith('~') || /^[A-Za-z]:[\\/]/.test(value)) {
        if (path.resolve(expandHome(value)) === path.resolve(repoRoot)) return team
      } else if (value.includes('/')) {
        if (remote === undefined) {
          const url = await runGit(repoRoot, ['remote', 'get-url', 'origin'])
          remote = url.ok ? normalizeRemote(url.stdout) : null
        }
        if (remote && remote === value.toLowerCase()) return team
      } else if (value.toLowerCase() === name) {
        return team
      }
    }
  }
  return undefined
}

export interface RoutedEntry {
  entry: Entry
  team?: TeamConfig
}

/**
 * Kaydı doğru vault'a yazan TEK yol. Takım verilmezse kişisel vault — takıma
 * yazmak her zaman açık bir karardır.
 */
export async function createRoutedEntry(config: DevlogConfig, draft: EntryDraft): Promise<RoutedEntry> {
  const { team: teamId, ...rest } = draft
  if (!teamId) return { entry: await createEntry(config.vaultRoot, rest) }

  const team = findTeam(config, teamId)
  if (!team) {
    const known = (config.teams ?? []).map((t) => t.id).join(', ') || 'yok'
    throw new Error(`Tanınmayan takım: ${teamId} (tanımlı: ${known})`)
  }
  if (team.enabled === false) throw new Error(`Takım kapalı: ${team.id}`)
  // Klon yoksa düz bir klasöre yazmak, kaydı hiçbir zaman gitmeyecek bir yere
  // bırakmak olurdu — sessiz kayıp yerine görünür hata.
  if (!(await isTeamClone(team))) {
    throw new Error(`Takım klonu yok: ${team.root} — önce \`devlog team add ${team.id} …\``)
  }
  const entry = await createEntry(team.root, { ...rest, author: team.author }, `team:${team.id}`)
  return { entry, team }
}

/** Kaydın ait olduğu takım (takım kaynağından geliyorsa). */
export function teamOfEntry(config: DevlogConfig, entry: Pick<Entry, 'sourceId'>): TeamConfig | undefined {
  if (!entry.sourceId.startsWith('team:')) return undefined
  return findTeam(config, entry.sourceId.slice('team:'.length))
}
