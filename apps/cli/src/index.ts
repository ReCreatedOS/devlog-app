import { promises as fsp } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parseArgs } from 'node:util'
import {
  ENTRY_TYPES,
  SEVERITIES,
  STATUSES,
  TYPE_META,
  TEAM_ID_RE,
  activeTeams,
  captureToDraft,
  createEntry,
  createRoutedEntry,
  isTeamClone,
  loadConfig,
  prepareTeam,
  readSyncState,
  saveConfig,
  spawnBackgroundSync,
  syncTeam,
  teamOfEntry,
  withTeam,
  withoutTeam,
  localDayKey,
  localIso,
  openIndex,
  parseCapture,
  redact,
  scanSecrets,
  trackEntry,
  trackingState,
  writeEntry,
} from '@devlog/core'
import type {
  DevlogConfig,
  Entry,
  EntryDraft,
  EntryStatus,
  EntrySummary,
  EntryType,
  QueryFilter,
  Severity,
  TeamConfig,
  TeamSyncResult,
  TrackingPatch,
} from '@devlog/core'

import { listTranscripts, readTranscript, sessionChanged, sessionDraft } from './sessions.js'

const USAGE = `devlog — ürün geliştirme seyir defteri

KULLANIM
  devlog new       --title T --type X [seçenekler]   yeni kayıt
  devlog capture   "metin /tür !sev @alan #etiket"   satır içi komut diliyle kayıt
  devlog list      [filtreler]                       kayıtları listele
  devlog search    "sorgu" [filtreler]               tam metin ara (Türkçe katlamalı)
  devlog show      <id>                              tek kaydı göster
  devlog append    <id> --body -                     gövdeye ekle
  devlog status    <id> [durum] [--next|--review]    durumu/takip alanlarını değiştir
  devlog timeline  --day YYYY-MM-DD                  o günün akışı
  devlog backfill  [--since 30d] [--all] [--dry-run]  geçmiş Claude oturumlarını aktar
  devlog where                                       vault yolunu yazdır
  devlog doctor                                      yapılandırma ve sağlık

TAKIM (ortak feed — GitHub üstünden, sunucusuz)
  devlog team add [<id>] --remote URL [--author ad] [--path dizin] [--label L] [--repo R]…
                     takım deposunu klonla ve tanımla (aynı id ile tekrar = güncelle;
                     id verilmezse depo adından: devlog-ekip → ekip)
  devlog team list                                   takımlar ve son eşitleme
  devlog team remove <id>                            takımdan ayrıl (klon diskte kalır)
  devlog sync [id…] [--wait]                         commit'le, al, it
  devlog new … --team <id>   /   devlog capture "… +<id>"
                     kayıt takıma gider; verilmezse kişisel vault (takım görmez)
  --repo: commit/deploy hook kayıtları bu kod depolarından geliyorsa takıma
  düşer (depo adı, mutlak yol ya da sahip/depo). Oturum özetleri asla gitmez.
  Takıma gidecek dosyada sır tespit edilirse eşitleme o dosyayı İTMEZ.

FİLTRELER
  --since 7d|24h|YYYY-MM-DD   --until YYYY-MM-DD
  --type T   --status S   --severity V   --tag T   --source S   --limit N
  --stale                     yalnız bayatlayanlar (aktif durumda, eşiği aşmış)

TAKİP (status)
  devlog status <id> open|in-progress|blocked|monitoring|fixed|done|wontfix
  --next "sıradaki adım"   --review YYYY-MM-DD   --pin/--unpin   --note "not"
  --severity critical|high|medium|low|info
  --since YYYY-MM-DD   durumun NE ZAMANDAN BERİ böyle olduğu (bayatlık bundan
                       sayılır; geriye dönük kayıt konuyu taze göstermesin)
  Ayna kayıtlarında da çalışır: değişiklik vault'taki tracking/<id>.md dosyasına
  yazılır, kaynak dosyaya tek bayt dokunulmaz.

KAYIT ALANLARI (new)
  --title   --type   --severity   --status   --area   --project   --team id
  --tag t (tekrarlanabilir)   --commit sha   --file yol   --url u
  --occurred ISO   --body METİN | --body -   (- = stdin'den oku)

SIR KORUMASI
  Gövdede token/anahtar tespit edilirse kayıt REDDEDİLİR.
  --redact ile maskele (otomasyon bunu kullanır), --allow-secrets ile zorla.

Her komut --json kabul eder (ajanlar için birincil arayüz).
`

function fail(message: string): never {
  process.stderr.write(`devlog: ${message}\n`)
  process.exit(1)
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks).toString('utf8')
}

/** `7d` / `24h` / `2026-07-01` → gün anahtarı (`YYYY-MM-DD`). */
function resolveDayKey(value: string): string {
  const relative = /^(\d+)([dhw])$/.exec(value.trim())
  if (relative) {
    const amount = Number(relative[1])
    const unit = relative[2]
    const date = new Date()
    if (unit === 'h') date.setHours(date.getHours() - amount)
    else if (unit === 'w') date.setDate(date.getDate() - amount * 7)
    else date.setDate(date.getDate() - amount)
    return localDayKey(date.toISOString())
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) fail(`tarih anlaşılamadı: ${value}`)
  return localDayKey(parsed.toISOString())
}

function oneOf<T extends string>(value: string | undefined, allowed: readonly T[], label: string): T | undefined {
  if (value === undefined) return undefined
  if (!(allowed as readonly string[]).includes(value)) {
    fail(`geçersiz ${label}: ${value}\n  izin verilenler: ${allowed.join(', ')}`)
  }
  return value as T
}

const FILTER_OPTIONS = {
  since: { type: 'string' },
  until: { type: 'string' },
  type: { type: 'string', multiple: true },
  status: { type: 'string', multiple: true },
  severity: { type: 'string', multiple: true },
  tag: { type: 'string', multiple: true },
  source: { type: 'string', multiple: true },
  limit: { type: 'string' },
  stale: { type: 'boolean' },
  json: { type: 'boolean' },
} as const

type FilterValues = {
  since?: string
  until?: string
  type?: string[]
  status?: string[]
  severity?: string[]
  tag?: string[]
  source?: string[]
  limit?: string
  stale?: boolean
  json?: boolean
}

function toFilter(values: FilterValues, text?: string): QueryFilter {
  return {
    text,
    from: values.since ? resolveDayKey(values.since) : undefined,
    to: values.until ? resolveDayKey(values.until) : undefined,
    types: values.type?.map((v) => oneOf(v, ENTRY_TYPES, 'tür') as EntryType),
    statuses: values.status?.map((v) => oneOf(v, STATUSES, 'durum') as EntryStatus),
    severities: values.severity?.map((v) => oneOf(v, SEVERITIES, 'severity') as Severity),
    tags: values.tag,
    sources: values.source,
    stale: values.stale ? true : undefined,
    sort: 'newest',
  }
}

function summaryToJson(entry: EntrySummary): Record<string, unknown> {
  return {
    id: entry.id,
    title: entry.title,
    type: entry.type,
    severity: entry.severity,
    status: entry.status,
    occurred_at: entry.occurred_at,
    area: entry.area,
    project: entry.project,
    tags: entry.tags,
    source: entry.sourceId,
    read_only: entry.readOnly,
    derived: entry.derived,
    // Takip alanları: ajan "ne açık, ne çürüyor" sorusunu tek çağrıda cevaplasın.
    next_action: entry.next_action,
    next_review: entry.next_review,
    pinned: entry.pinned,
    status_since: entry.status_since,
    age_days: trackingState(entry).ageDays,
    stale: trackingState(entry).stale,
    overridden: entry.overridden,
    excerpt: entry.excerpt,
  }
}

function printSummaries(items: EntrySummary[], asJson: boolean): void {
  if (asJson) {
    process.stdout.write(`${JSON.stringify(items.map(summaryToJson), null, 2)}\n`)
    return
  }
  if (items.length === 0) {
    process.stdout.write('(kayıt yok)\n')
    return
  }
  for (const entry of items) {
    const day = localDayKey(entry.occurred_at)
    const time = new Date(entry.occurred_at)
    const hhmm = Number.isNaN(time.getTime())
      ? '--:--'
      : `${String(time.getHours()).padStart(2, '0')}:${String(time.getMinutes()).padStart(2, '0')}`
    const badge = TYPE_META[entry.type].badge.padEnd(4)
    const state = trackingState(entry)
    const status = entry.status
      ? ` [${entry.status}${state.active ? ` ${state.ageDays}g${state.stale ? '!' : ''}` : ''}]`
      : ''
    const severity = entry.severity ? ` (${entry.severity})` : ''
    process.stdout.write(`${day} ${hhmm}  ${badge}  ${entry.title}${severity}${status}\n`)
  }
  process.stdout.write(`\n${items.length} kayıt\n`)
}

/**
 * Sır koruması: otomasyon (hook'lar) `--redact` ile maskeler, insan yazımı
 * ise reddedilir. Sessizce yazmak en kötü seçenek — defter bir sır deposuna
 * dönüşür ve kimse fark etmez.
 */
function guardSecrets(body: string, redactFlag: boolean, allowFlag: boolean): string {
  if (redactFlag) {
    const result = redact(body)
    if (result.found.length > 0) {
      process.stderr.write(`devlog: maskelendi → ${result.found.join(', ')}\n`)
    }
    return result.text
  }
  const found = scanSecrets(body)
  if (found.length > 0 && !allowFlag) {
    fail(
      `gövdede sır tespit edildi: ${found.join(', ')}\n` +
        '  --redact ile maskele, ya da bilinçliyse --allow-secrets ile zorla.',
    )
  }
  return body
}

/**
 * Takım kaydına yazıldıysa eşitlemeyi arka plana bırak: komut ağ beklemeden
 * dönsün, push çevrimdışıyken düşse bile bir sonraki eşitleme toparlar.
 */
function afterWrite(config: DevlogConfig, entry: Pick<Entry, 'sourceId'>): TeamConfig | undefined {
  const team = teamOfEntry(config, entry)
  const script = process.argv[1]
  if (team && script) spawnBackgroundSync(script, team.id)
  return team
}

async function commandNew(argv: string[]): Promise<void> {
  const { values } = parseArgs({
    args: argv,
    options: {
      title: { type: 'string' },
      type: { type: 'string' },
      severity: { type: 'string' },
      status: { type: 'string' },
      area: { type: 'string' },
      project: { type: 'string' },
      tag: { type: 'string', multiple: true },
      commit: { type: 'string', multiple: true },
      file: { type: 'string', multiple: true },
      url: { type: 'string', multiple: true },
      link: { type: 'string', multiple: true },
      team: { type: 'string' },
      occurred: { type: 'string' },
      body: { type: 'string' },
      redact: { type: 'boolean' },
      'allow-secrets': { type: 'boolean' },
      json: { type: 'boolean' },
    },
  })

  if (!values.title) fail('--title zorunlu')
  const type = oneOf(values.type ?? 'note', ENTRY_TYPES, 'tür') as EntryType
  const rawBody = values.body === '-' ? await readStdin() : (values.body ?? '')
  const body = guardSecrets(rawBody, Boolean(values.redact), Boolean(values['allow-secrets']))

  const draft: EntryDraft = {
    title: values.title,
    type,
    body,
    team: values.team,
    severity: oneOf(values.severity, SEVERITIES, 'severity'),
    status: oneOf(values.status, STATUSES, 'durum'),
    area: values.area,
    project: values.project,
    tags: values.tag,
    occurred_at: values.occurred,
    refs: {
      commits: values.commit,
      files: values.file,
      urls: values.url,
      links: values.link,
    },
  }

  // `incident`/`security` şemada severity zorunlu — otomasyon unutmuşsa
  // kaydı düşürmek yerine en muhafazakâr değere düşüyoruz.
  if ((type === 'incident' || type === 'security') && !draft.severity) draft.severity = 'medium'

  const config = await loadConfig()
  const { entry, team } = await createRoutedEntry(config, draft)
  afterWrite(config, entry)
  if (values.json) {
    process.stdout.write(`${JSON.stringify({ id: entry.id, path: entry.path, team: team?.id })}\n`)
  } else {
    process.stdout.write(`${entry.id}\n${entry.path}\n${team ? `→ takım: ${team.label}\n` : ''}`)
  }
}

async function commandCapture(argv: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: { json: { type: 'boolean' }, redact: { type: 'boolean' } },
  })
  const text = positionals.join(' ').trim() || (await readStdin())
  const config = await loadConfig()
  const parsed = parseCapture(text, { teams: activeTeams(config).map((team) => team.id) })
  if (!parsed.title) fail('başlık boş')
  const draft = captureToDraft(parsed)
  draft.body = guardSecrets(draft.body, Boolean(values.redact), false)

  const { entry, team } = await createRoutedEntry(config, draft)
  afterWrite(config, entry)
  if (values.json) {
    process.stdout.write(`${JSON.stringify({ id: entry.id, path: entry.path, team: team?.id })}\n`)
  } else {
    process.stdout.write(`${entry.id}${team ? `  → takım: ${team.label}` : ''}\n`)
  }
}

async function commandList(argv: string[], withText: boolean): Promise<void> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: FILTER_OPTIONS,
  })
  const text = withText ? positionals.join(' ').trim() : undefined
  if (withText && !text) fail('arama sorgusu gerekli')

  const { index } = await openIndex()
  const limit = values.limit ? Number(values.limit) : 50
  const result = index.query(toFilter(values as FilterValues, text), limit)
  printSummaries(result.items, Boolean(values.json))
}

async function commandShow(argv: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: { json: { type: 'boolean' } },
  })
  const id = positionals[0]
  if (!id) fail('id gerekli')

  const { index } = await openIndex()
  const entry = index.get(id)
  if (!entry) fail(`kayıt bulunamadı: ${id}`)

  if (values.json) {
    const backlinks = index.backlinks(id).map((b) => b.id)
    process.stdout.write(`${JSON.stringify({ ...entry, backlinks }, null, 2)}\n`)
    return
  }
  process.stdout.write(`${entry.title}\n`)
  process.stdout.write(
    `${entry.type}${entry.severity ? ` · ${entry.severity}` : ''}${entry.status ? ` · ${entry.status}` : ''} · ${entry.occurred_at}\n`,
  )
  if (entry.tags?.length) process.stdout.write(`etiketler: ${entry.tags.join(', ')}\n`)
  process.stdout.write(`kaynak: ${entry.sourceId}${entry.readOnly ? ' (salt-okunur)' : ''}\n`)
  process.stdout.write(`${entry.path}\n\n${entry.body}\n`)
}

/** Salt-okunur aynadaki kayıtlar değiştirilemez — kaynağı başka bir aracın. */
function requireWritable(entry: Entry): void {
  if (!entry.readOnly) return
  if (entry.sourceId.startsWith('team:')) {
    fail(
      `bu takım kaydı ${entry.author ?? 'başkasına'} ait; başkasının dosyası düzenlenmez.\n` +
        `  Kendi kaydını aç ve gövdede [[${entry.id}]] ile bağla.`,
    )
  }
  fail(`kayıt salt-okunur bir aynadan geliyor: ${entry.sourceId}`)
}

async function commandAppend(argv: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: { body: { type: 'string' }, redact: { type: 'boolean' }, json: { type: 'boolean' } },
  })
  const id = positionals[0]
  if (!id) fail('id gerekli')

  const { index, config } = await openIndex()
  const entry = index.get(id)
  if (!entry) fail(`kayıt bulunamadı: ${id}`)
  requireWritable(entry)

  const addition = values.body === '-' || !values.body ? await readStdin() : values.body
  const safe = guardSecrets(addition, Boolean(values.redact), false)
  const { body: _body, path: _path, sourceId: _s, readOnly: _r, derived: _d, outboundLinks: _o, ...frontmatter } = entry
  const next = { ...frontmatter, updated_at: localIso() }
  const written = await writeEntry(
    config.vaultRoot,
    next,
    `${entry.body.trimEnd()}\n\n${safe.trim()}`,
    entry.path,
  )
  afterWrite(config, entry)
  if (values.json) process.stdout.write(`${JSON.stringify({ id, path: written })}\n`)
  else process.stdout.write(`${written}\n`)
}

/**
 * Durum ve diğer takip alanları. Ayna kayıtlarında da çalışır — orada değişiklik
 * kaynağa değil vault'taki takip dosyasına yazılır, `trackEntry` yönlendirir.
 */
async function commandStatus(argv: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      json: { type: 'boolean' },
      severity: { type: 'string' },
      since: { type: 'string' },
      next: { type: 'string' },
      review: { type: 'string' },
      pin: { type: 'boolean' },
      unpin: { type: 'boolean' },
      note: { type: 'string' },
      agent: { type: 'boolean' },
    },
  })
  const [id, status] = positionals
  if (!id) fail('kullanım: devlog status <id> [<durum>] [--next "adım"] [--review YYYY-MM-DD]')

  const patch: TrackingPatch = {}
  if (status) patch.status = oneOf(status, STATUSES, 'durum') as EntryStatus
  if (values.severity !== undefined) {
    patch.severity = values.severity ? (oneOf(values.severity, SEVERITIES, 'severity') as Severity) : null
  }
  if (values.since !== undefined) patch.status_since = values.since || null
  if (values.next !== undefined) patch.next_action = values.next || null
  if (values.review !== undefined) patch.next_review = values.review || null
  if (values.note !== undefined) patch.note = values.note || null
  if (values.pin) patch.pinned = true
  if (values.unpin) patch.pinned = false
  if (Object.keys(patch).length === 0) fail('değiştirilecek bir alan verilmedi')

  const { index, config } = await openIndex()
  const entry = index.get(id)
  if (!entry) fail(`kayıt bulunamadı: ${id}`)

  const outcome = await trackEntry(
    config.vaultRoot,
    entry,
    { ...patch, next_action: mask(patch.next_action), note: mask(patch.note) },
    values.agent ? 'agent' : 'user',
  )
  // Başkasının takım kaydını izlemek kişisel takip dosyasına yazar — takıma gitmez.
  if (outcome.target === 'entry') afterWrite(config, entry)
  if (values.json) {
    process.stdout.write(
      `${JSON.stringify({ id, ...patch, target: outcome.target, path: outcome.path })}\n`,
    )
    return
  }
  const what = patch.status ? `${id} → ${patch.status}` : id
  const where = outcome.target === 'tracking' ? ' (takip dosyası — kaynağa yazılmadı)' : ''
  process.stdout.write(`${what}${where}\n${outcome.path}\n`)
}

/** Takip metinleri de depoya giriyor; gövdelerdeki sır maskesi burada da geçerli. */
function mask(value: string | null | undefined): string | null | undefined {
  return typeof value === 'string' ? redact(value).text : value
}

/**
 * Geçmiş Claude oturumlarını deftere aktarır.
 *
 * `SessionEnd` hook'u yalnız KURULDUĞU GÜNDEN sonraki oturumları yakalıyor;
 * ondan öncekiler (ve hook'un çalışamadığı, oturumun sert kapandığı haller)
 * transcript olarak diskte duruyor ama defterde yok. Bu komut o boşluğu
 * kapatır ve hook ile AYNI kayıt biçimini üretir (`sessions.ts`).
 *
 * Tekilleştirme oturum id'si üzerinden: aynı oturum iki kez aktarılmaz, komut
 * istediğin kadar tekrar çalıştırılabilir.
 */
async function commandBackfill(argv: string[]): Promise<void> {
  const { values } = parseArgs({
    args: argv,
    options: {
      since: { type: 'string' },
      all: { type: 'boolean' },
      'dry-run': { type: 'boolean' },
      json: { type: 'boolean' },
    },
  })
  const since = values.since ? resolveDayKey(values.since) : undefined
  const dry = Boolean(values['dry-run'])

  const { index, config } = await openIndex()
  // Var olan kayıtların gövdelerindeki oturum işaretleyicileri tek turda topla.
  const logged = new Set<string>()
  for (const item of index.query({ sort: 'newest' }, Number.MAX_SAFE_INTEGER).items) {
    const entry = index.get(item.id)
    if (!entry || entry.readOnly) continue
    for (const match of entry.body.matchAll(/<sub>oturum: ([^<]+)<\/sub>/g)) {
      const id = match[1]
      if (id) logged.add(id.trim())
    }
  }

  const transcripts = await listTranscripts()
  const created: string[] = []
  const skipped = { kayitli: 0, degismedi: 0, eski: 0, bos: 0 }

  const summaries = []
  for (const file of transcripts) {
    const summary = await readTranscript(file).catch(() => null)
    if (!summary || !summary.sessionId) {
      skipped.bos += 1
      continue
    }
    summaries.push({ file, summary })
  }
  // Kronolojik: defterde eskiden yeniye doğru dizilsin.
  summaries.sort((a, b) => (a.summary.firstTimestamp ?? '').localeCompare(b.summary.firstTimestamp ?? ''))

  for (const { file, summary } of summaries) {
    if (logged.has(summary.sessionId!)) {
      skipped.kayitli += 1
      continue
    }
    if (since && (summary.firstTimestamp ?? '').slice(0, 10) < since) {
      skipped.eski += 1
      continue
    }
    if (!values.all && !sessionChanged(summary)) {
      skipped.degismedi += 1
      continue
    }

    const draft = sessionDraft(summary, summary.cwd ?? path.dirname(file))
    if (dry) {
      created.push(`${(summary.firstTimestamp ?? '').slice(0, 16)}  ${draft.title}`)
      continue
    }
    const entry = await createEntry(config.vaultRoot, draft)
    logged.add(summary.sessionId!)
    created.push(`${entry.id}`)
  }

  if (values.json) {
    process.stdout.write(`${JSON.stringify({ created, skipped, dry }, null, 2)}\n`)
    return
  }
  for (const line of created) process.stdout.write(`${dry ? 'yazılacak' : 'yazıldı'}  ${line}\n`)
  process.stdout.write(
    `\n${created.length} oturum ${dry ? 'aktarılacak' : 'aktarıldı'} · atlandı: ` +
      `${skipped.kayitli} zaten kayıtlı, ${skipped.degismedi} bir şey değiştirmedi` +
      `${skipped.eski ? `, ${skipped.eski} tarih dışı` : ''}` +
      `${skipped.bos ? `, ${skipped.bos} okunamadı` : ''}\n`,
  )
}

async function commandTimeline(argv: string[]): Promise<void> {
  const { values } = parseArgs({
    args: argv,
    options: { day: { type: 'string' }, json: { type: 'boolean' } },
  })
  const day = values.day ? resolveDayKey(values.day) : localDayKey(new Date().toISOString())
  const { index } = await openIndex()
  const result = index.query({ from: day, to: day, sort: 'oldest' }, 500)
  if (values.json) {
    process.stdout.write(
      `${JSON.stringify({ day, count: result.total, items: result.items.map(summaryToJson) }, null, 2)}\n`,
    )
    return
  }
  process.stdout.write(`${day} — ${result.total} kayıt\n\n`)
  printSummaries(result.items, false)
}

/** `12 sn önce` — eşitleme durumunu insan diliyle. */
function ago(iso: string): string {
  const seconds = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000))
  if (seconds < 60) return `${seconds} sn önce`
  if (seconds < 3600) return `${Math.round(seconds / 60)} dk önce`
  if (seconds < 86_400) return `${Math.round(seconds / 3600)} sa önce`
  return `${Math.round(seconds / 86_400)} gün önce`
}

function describeSync(result: TeamSyncResult): string {
  if (result.skipped === 'busy') return 'başka bir süreç eşitliyor'
  const parts: string[] = []
  if (result.committed) parts.push(`${result.committed} dosya commit'lendi`)
  if (result.pulled) parts.push(`${result.pulled} commit alındı`)
  if (result.pushed) parts.push(`${result.pushed} commit itildi`)
  if (parts.length === 0 && result.ok) parts.push('güncel')
  if (result.error) parts.push(`HATA: ${result.error}`)
  return parts.join(' · ')
}

function printSyncWarnings(result: TeamSyncResult): void {
  for (const item of result.blocked) {
    process.stdout.write(`  ✗ itilmedi (sır: ${item.found.join(', ')}): ${item.path}\n`)
  }
  for (const file of result.foreign) {
    process.stdout.write(`  ! başkasının dosyası yerelde değişmiş, commit'lenmedi: ${file}\n`)
  }
}

async function commandTeam(argv: string[]): Promise<void> {
  const [sub, ...rest] = argv
  if (sub === 'add') return commandTeamAdd(rest)
  if (sub === 'remove') return commandTeamRemove(rest)
  if (sub === 'list' || sub === undefined) return commandTeamList(rest)
  fail('kullanım: devlog team add [<id>] --remote URL … | devlog team list | devlog team remove <id>')
}

async function commandTeamRemove(argv: string[]): Promise<void> {
  const id = argv[0]?.toLowerCase()
  const config = await loadConfig()
  const team = id ? (config.teams ?? []).find((item) => item.id === id) : undefined
  if (!team) fail(`tanımlı takım değil: ${id ?? '(boş)'}`)
  await saveConfig(withoutTeam(config, team.id))
  // Klon silinmez: içinde itilmemiş kendi kayıtların olabilir.
  process.stdout.write(`${team.id} çıkarıldı; klon diskte duruyor: ${team.root}\n`)
}

async function commandTeamAdd(argv: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      remote: { type: 'string' },
      author: { type: 'string' },
      path: { type: 'string' },
      label: { type: 'string' },
      repo: { type: 'string', multiple: true },
      json: { type: 'boolean' },
    },
  })
  const id = positionals[0]?.toLowerCase()
  if (id && !TEAM_ID_RE.test(id)) fail('takım id\'si: küçük harf, rakam, tire (ör. `ekip`)')

  const config = await loadConfig()
  const existing = id ? (config.teams ?? []).find((team) => team.id === id) : undefined
  const remote = values.remote ?? existing?.remote
  if (!remote) fail('--remote gerekli (ör. git@github.com:Org/devlog-ekip.git — private olmalı)')

  const team = await prepareTeam(config, {
    remote,
    id,
    author: values.author,
    label: values.label,
    root: values.path ? path.resolve(values.path) : undefined,
    repos: values.repo,
  })
  await saveConfig(withTeam(config, team))

  // İlk eşitleme: boş depoya rehber dosyalarını koyar, dolu depodan feed'i alır.
  const result = await syncTeam(team, { wait: 30_000 })
  if (values.json) {
    process.stdout.write(`${JSON.stringify({ team, sync: result }, null, 2)}\n`)
    return
  }
  process.stdout.write(`takım      ${team.label} (${team.id})\n`)
  process.stdout.write(`klon       ${team.root}\n`)
  process.stdout.write(`yazar      ${team.author}\n`)
  process.stdout.write(`depolar    ${team.repos?.join(', ') || '— (commit/deploy kayıtları kişisel kalır)'}\n`)
  process.stdout.write(`eşitleme   ${describeSync(result)}\n`)
  printSyncWarnings(result)
  if (!result.ok) process.exitCode = 1
}

async function commandTeamList(argv: string[]): Promise<void> {
  const { values } = parseArgs({ args: argv, options: { json: { type: 'boolean' } } })
  const config = await loadConfig()
  const teams = config.teams ?? []
  const rows = await Promise.all(
    teams.map(async (team) => ({
      ...team,
      cloned: await isTeamClone(team),
      lastSync: await readSyncState(team.id),
    })),
  )
  if (values.json) {
    process.stdout.write(`${JSON.stringify(rows, null, 2)}\n`)
    return
  }
  if (rows.length === 0) {
    process.stdout.write('tanımlı takım yok — `devlog team add <id> --remote URL`\n')
    return
  }
  for (const row of rows) {
    const off = row.enabled === false ? ' (kapalı)' : ''
    process.stdout.write(`${row.id}${off}  ${row.label}  @${row.author}\n`)
    process.stdout.write(`  klon      ${row.root}${row.cloned ? '' : '  ✗ YOK'}\n`)
    process.stdout.write(`  depolar   ${row.repos?.join(', ') || '—'}\n`)
    process.stdout.write(
      `  eşitleme  ${row.lastSync ? `${ago(row.lastSync.at)} · ${describeSync(row.lastSync)}` : 'hiç'}\n`,
    )
  }
}

async function commandSync(argv: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: { wait: { type: 'boolean' }, quiet: { type: 'boolean' }, json: { type: 'boolean' } },
  })
  const config = await loadConfig()
  const all = activeTeams(config)
  const selected = positionals.length ? all.filter((team) => positionals.includes(team.id)) : all
  if (positionals.length && selected.length !== positionals.length) {
    fail(`tanınmayan ya da kapalı takım: ${positionals.filter((id) => !selected.some((t) => t.id === id)).join(', ')}`)
  }
  if (selected.length === 0) {
    if (!values.quiet) process.stdout.write('tanımlı takım yok\n')
    return
  }
  // `--wait`: hook'un arka plan süreci, o an çalışan bir eşitlemeyi beklesin;
  // yoksa yeni yazılan kayıt bir sonraki tura kadar itilmeden kalırdı.
  const results = await Promise.all(selected.map((team) => syncTeam(team, { wait: values.wait ? 90_000 : 0 })))
  if (values.json) process.stdout.write(`${JSON.stringify(results, null, 2)}\n`)
  else if (!values.quiet) {
    for (const result of results) {
      process.stdout.write(`${result.team}  ${describeSync(result)}\n`)
      printSyncWarnings(result)
    }
  }
  if (results.some((result) => !result.ok)) process.exitCode = 1
}

async function commandWhere(argv: string[]): Promise<void> {
  const { values } = parseArgs({ args: argv, options: { json: { type: 'boolean' } } })
  const config = await loadConfig()
  if (values.json) process.stdout.write(`${JSON.stringify(config, null, 2)}\n`)
  else process.stdout.write(`${config.vaultRoot}\n`)
}

/**
 * Hook'lar kurulu mu ve derlenmiş mi?
 *
 * `dist/` git'e girmiyor: taze bir clone'dan sonra `pnpm build:tools`
 * çalıştırılmazsa hook'lar SESSİZCE devre dışı kalır (hook'lar hiçbir koşulda
 * oturumu bloklamaz, yani hata da görmezsin). Teşhisin ilk durağı burası.
 */
async function hookHealth(): Promise<Array<{ name: string; ok: boolean; detail: string }>> {
  const settingsPath = path.join(os.homedir(), '.claude', 'settings.json')
  let settings: Record<string, unknown> = {}
  try {
    settings = JSON.parse(await fsp.readFile(settingsPath, 'utf8')) as Record<string, unknown>
  } catch {
    return [
      {
        name: 'settings.json',
        ok: false,
        detail: `${settingsPath} okunamadı — Claude Code entegrasyonu kurulu değil (isteğe bağlı)`,
      },
    ]
  }
  const hooks = (settings.hooks ?? {}) as Record<string, unknown>
  const wanted = [
    ['PostToolUse', 'hook-tool-use.mjs'],
    ['SessionEnd', 'hook-session-end.mjs'],
  ] as const

  const out: Array<{ name: string; ok: boolean; detail: string }> = []
  for (const [event, file] of wanted) {
    const raw = JSON.stringify(hooks[event] ?? '')
    if (!raw.includes(file)) {
      out.push({ name: event, ok: false, detail: 'settings.json içinde tanımlı değil' })
      continue
    }
    // Yol `args` içinde ayrı bir dize olabilir ya da `"node /yol/x.mjs"` gibi
    // komutun parçası; Windows'ta `C:\…` ile başlar ve boşluk içerebilir.
    const strings: string[] = []
    const collect = (value: unknown): void => {
      if (typeof value === 'string') strings.push(value)
      else if (value && typeof value === 'object') Object.values(value).forEach(collect)
    }
    collect(hooks[event])
    const target = strings
      .map((value) => value.trim().replace(/^node(?:\.exe)?\s+/i, '').replace(/^["']|["']$/g, ''))
      .find((value) => value.endsWith(file))
    if (!target) {
      out.push({ name: event, ok: false, detail: 'yol çözülemedi' })
      continue
    }
    try {
      await fsp.access(target)
      out.push({ name: event, ok: true, detail: target })
    } catch {
      out.push({ name: event, ok: false, detail: `derlenmemiş: ${target} (pnpm build:tools)` })
    }
  }
  return out
}

/** Diskteki oturum transcript'lerinin kaçı deftere geçmiş. */
async function sessionCoverage(
  index: Awaited<ReturnType<typeof openIndex>>['index'],
): Promise<{ total: number; logged: number; missing: number }> {
  const logged = new Set<string>()
  for (const item of index.query({ sort: 'newest' }, Number.MAX_SAFE_INTEGER).items) {
    const entry = index.get(item.id)
    if (!entry || entry.readOnly) continue
    for (const match of entry.body.matchAll(/<sub>oturum: ([^<]+)<\/sub>/g)) {
      const id = match[1]
      if (id) logged.add(id.trim())
    }
  }
  const transcripts = await listTranscripts()
  let missing = 0
  for (const file of transcripts) {
    const id = path.basename(file, '.jsonl')
    if (!logged.has(id)) missing += 1
  }
  return { total: transcripts.length, logged: transcripts.length - missing, missing }
}

async function commandDoctor(argv: string[]): Promise<void> {
  const { values } = parseArgs({ args: argv, options: { json: { type: 'boolean' } } })
  const { index, config, failures, orphanTracking, collisions } = await openIndex()
  const facets = index.facets()
  const hooks = await hookHealth()
  const sessions = await sessionCoverage(index)
  const report = {
    vaultRoot: config.vaultRoot,
    entries: index.size(),
    sources: [
      { id: 'vault', label: 'Seyir defteri', count: facets.sources['vault'] ?? 0 },
      ...(config.teams ?? []).map((team) => ({
        id: `team:${team.id}`,
        label: `Takım · ${team.label}`,
        count: facets.sources[`team:${team.id}`] ?? 0,
      })),
      ...config.sources.map((s) => ({
        id: s.id,
        label: s.label,
        count: facets.sources[s.id] ?? 0,
      })),
    ],
    byType: facets.types,
    teams: await Promise.all(
      (config.teams ?? []).map(async (team) => ({
        id: team.id,
        root: team.root,
        author: team.author,
        cloned: await isTeamClone(team),
        lastSync: await readSyncState(team.id),
      })),
    ),
    hooks,
    sessions,
    orphanTracking,
    collisions,
    invalidFiles: failures.map((f) => ({ path: f.path, errors: f.errors })),
  }
  if (values.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
    return
  }
  process.stdout.write(`vault      ${report.vaultRoot}\n`)
  process.stdout.write(`kayıt      ${report.entries}\n`)
  for (const source of report.sources) {
    process.stdout.write(`  ${source.label.padEnd(24)} ${source.count}\n`)
  }
  if (report.teams.length > 0) {
    process.stdout.write('\ntakım\n')
    for (const team of report.teams) {
      const state = !team.cloned
        ? `✗ klon yok: ${team.root}`
        : team.lastSync
          ? `${team.lastSync.ok ? '✓' : '✗'} ${ago(team.lastSync.at)} · ${describeSync(team.lastSync)}`
          : '· henüz eşitlenmedi'
      process.stdout.write(`  ${team.id.padEnd(14)} @${team.author}  ${state}\n`)
    }
  }
  process.stdout.write('\nhook\n')
  for (const hook of report.hooks) {
    process.stdout.write(`  ${hook.ok ? '✓' : '✗'} ${hook.name.padEnd(14)} ${hook.detail}\n`)
  }

  process.stdout.write(
    `\noturum     ${report.sessions.logged}/${report.sessions.total} transcript deftere geçmiş\n`,
  )
  if (report.sessions.missing > 0) {
    process.stdout.write(
      `  ${report.sessions.missing} oturum eksik — \`devlog backfill --all\` ile aktar\n`,
    )
  }

  if (report.orphanTracking.length > 0) {
    process.stdout.write(
      `\n${report.orphanTracking.length} takip dosyası kaynağını kaybetti:\n  ${report.orphanTracking.join('\n  ')}\n`,
    )
  }
  if (report.collisions.length > 0) {
    process.stdout.write(
      `\n${report.collisions.length} kayıt id'si çakışıyor:\n  ${report.collisions.join('\n  ')}\n`,
    )
  }

  if (report.invalidFiles.length > 0) {
    process.stdout.write(`\nşemaya uymayan ${report.invalidFiles.length} dosya:\n`)
    for (const item of report.invalidFiles) {
      process.stdout.write(`  ${item.path}\n    ${item.errors.join('; ')}\n`)
    }
  }
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2)
  // `devlog new --help` parseArgs'ta "bilinmeyen seçenek" diye patlamasın.
  if (rest.includes('--help') || rest.includes('-h')) {
    process.stdout.write(USAGE)
    return
  }
  switch (command) {
    case 'new':
      return commandNew(rest)
    case 'capture':
      return commandCapture(rest)
    case 'list':
      return commandList(rest, false)
    case 'search':
      return commandList(rest, true)
    case 'show':
      return commandShow(rest)
    case 'append':
      return commandAppend(rest)
    case 'status':
      return commandStatus(rest)
    case 'backfill':
      return commandBackfill(rest)
    case 'timeline':
      return commandTimeline(rest)
    case 'where':
      return commandWhere(rest)
    case 'doctor':
      return commandDoctor(rest)
    case 'team':
      return commandTeam(rest)
    case 'sync':
      return commandSync(rest)
    case undefined:
    case '-h':
    case '--help':
    case 'help':
      process.stdout.write(USAGE)
      return
    default:
      fail(`bilinmeyen komut: ${command}\n\n${USAGE}`)
  }
}

main().catch((error: unknown) => {
  fail(error instanceof Error ? error.message : String(error))
})
