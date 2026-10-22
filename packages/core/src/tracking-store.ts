/**
 * Takip dosyaları — salt-okunur kayıtların üstüne binen, VAULT'a ait durum katmanı.
 *
 * Sorun şuydu: takip edilen konuların neredeyse tamamı Claude memory aynasında
 * yaşıyor ve o dosyalar başka bir aracın dosyaları. Adaptör oraya tek bayt
 * yazmıyor (bilinçli invariant), dolayısıyla bir bulgunun durumu yalnızca
 * gövdeden ÇIKARILABİLİYOR ve ne kullanıcı ne ajan onu düzeltebiliyordu.
 *
 * Çözüm: kaynağı hiç ellemeden, kendi vault'umuzda kayıt başına bir takip
 * dosyası tutmak.
 *
 *     devlog-vault/tracking/<entry-id>.md
 *
 * Okuma yolunda bu dosya kaynağın üstüne biner ve değiştirdiği alanlar
 * `Entry.overridden` ile işaretlenir — `derived`'ın tersi: tahmin değil, karar.
 *
 * Geçmiş tutulmaz. Vault zaten bir git deposu; "ne zaman açıktan devam ediyora
 * geçti" sorusunun cevabı `git log`'dadır. Frontmatter'a ikinci bir tarihçe
 * koymak dosyayı şişirir ve iki gerçek yaratır.
 */
import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import YAML from 'yaml'
import { localIso } from './entry.js'
import { slugify } from './fold.js'
import { parseDocument } from './frontmatter.js'
import { STATUSES, SEVERITIES } from './types.js'
import type { Entry, EntryFrontmatter, EntryStatus, Severity, TrackingPatch } from './types.js'
import { writeEntry, writeFileAtomic } from './vault.js'

/** Takip dosyasının frontmatter kontratı. */
export interface TrackingRecord {
  /** Üstüne bindiği kaydın id'si. Dosya adıyla aynıdır. */
  tracks: string
  /** Kaydın geldiği kaynak — öksüz takip dosyasını tanımak için. */
  source?: string
  /**
   * Kaynak dosyanın adı. Kaydın `id`'si değişirse (ayna kayıtlarında id, memory
   * dosyasının `name` alanıdır ve elle değiştirilebilir) eşleşmeyi bunun
   * üstünden kurtarırız.
   */
  source_file?: string
  status?: EntryStatus
  severity?: Severity
  next_action?: string
  next_review?: string
  pinned?: boolean
  /** Durumun en son değiştiği an. */
  status_since?: string
  updated_at: string
  /** Son dokunan: elle mi, ajan mı. Ajanın kullanıcı kararını sessizce ezmemesi için. */
  by?: 'user' | 'agent'
  /** Serbest not — kaynağın gövdesine dokunmadan kullanıcının kendi yorumu. */
  note?: string
  /**
   * Tanımadığımız frontmatter anahtarları. Olduğu gibi geri yazılır: daha yeni
   * bir devlog sürümünün eklediği bir alan, henüz güncellenmemiş bir araçla
   * durum değiştirildiğinde SESSİZCE silinmemeli.
   */
  extra?: Record<string, unknown>
}

export function trackingDir(vaultRoot: string): string {
  return path.join(vaultRoot, 'tracking')
}

/**
 * Dosya adı id'den TÜRETİLİR ama id'nin kendisi değildir.
 *
 * Kayıt id'si her zaman bizim ürettiğimiz bir slug değil: ayna kayıtlarında
 * memory dosyasının `name` alanından geliyor, yani başka bir aracın yazdığı
 * serbest metin. Ham hâliyle yola koymak iki şeyi kırar — `../` içeren bir ad
 * vault dışına yazar, ve APFS büyük/küçük harfi ayırmadığı için `Vuln-A` ile
 * `vuln-a` TEK dosyaya düşüp iki kaydın durumunu birbirine karıştırır.
 *
 * Slug okunabilirliği, kısa özet çakışmasızlığı verir. Gerçek kimlik dosya
 * adında değil, içerideki `tracks` alanındadır — okuma yolu ona güvenir.
 */
export function trackingFileName(id: string): string {
  const digest = createHash('sha1').update(id).digest('hex').slice(0, 8)
  return `${slugify(id).slice(0, 80)}-${digest}.md`
}

export function trackingPath(vaultRoot: string, id: string): string {
  return path.join(trackingDir(vaultRoot), trackingFileName(id))
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function asEnum<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : undefined
}

/**
 * Hoşgörülü ayrıştırma: tanınmayan bir durum değeri dosyayı düşürmez, o alan
 * yok sayılır. Vault araçlardan uzun yaşar — henüz güncellenmemiş bir araç,
 * daha yeni bir devlog'un yazdığı takip dosyasını görünmez yapmamalı.
 */
export function parseTracking(raw: string, fallbackId: string): TrackingRecord | null {
  const { data, body } = parseDocument(raw)
  const tracks = asString(data.tracks) ?? fallbackId
  if (!tracks) return null

  const known = new Set<string>([...(KEY_ORDER as readonly string[]), 'note'])
  const extra: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(data)) {
    if (!known.has(key)) extra[key] = value
  }

  return {
    tracks,
    source: asString(data.source),
    source_file: asString(data.source_file),
    status: asEnum(data.status, STATUSES),
    severity: asEnum(data.severity, SEVERITIES),
    next_action: asString(data.next_action),
    next_review: asString(data.next_review),
    pinned: data.pinned === true,
    status_since: asString(data.status_since),
    updated_at: asString(data.updated_at) ?? localIso(),
    by: data.by === 'agent' ? 'agent' : data.by === 'user' ? 'user' : undefined,
    note: body.trim() || undefined,
    extra: Object.keys(extra).length > 0 ? extra : undefined,
  }
}

export async function readTracking(absPath: string): Promise<TrackingRecord | null> {
  try {
    const raw = await fs.readFile(absPath, 'utf8')
    return parseTracking(raw, path.basename(absPath, '.md'))
  } catch {
    return null
  }
}

/**
 * Vault'taki tüm takip dosyaları — `id → kayıt`.
 *
 * Anahtar dosya adından değil `tracks` alanından gelir: dosya adı id'nin
 * güvenli bir türevidir, kimliğin kendisi değil.
 */
export async function loadTracking(vaultRoot: string): Promise<Map<string, TrackingRecord>> {
  const dir = trackingDir(vaultRoot)
  let names: string[]
  try {
    names = await fs.readdir(dir)
  } catch {
    return new Map()
  }
  const found = new Map<string, TrackingRecord>()
  await Promise.all(
    names
      .filter((name) => name.endsWith('.md') && !name.startsWith('.'))
      .map(async (name) => {
        const record = await readTracking(path.join(dir, name))
        if (record) found.set(record.tracks, record)
      }),
  )
  return found
}

/**
 * Takip kayıtlarını kayıtlara bağlar.
 *
 * İki aşamalı eşleme, çünkü ayna kayıtlarında `id` sabit değil: memory
 * dosyasının `name` alanından geliyor ve o alan elle değiştirilebilir. Id
 * tutmazsa kaynak DOSYA ADINDAN kurtarmayı deniyoruz — yoksa kullanıcının elle
 * verdiği karar sessizce kaybolur ve satır çıkarılmış duruma geri döner.
 * Eşleşmeyenler silinmez, `orphans` olarak bildirilir.
 */
export function matchTracking(
  entries: Entry[],
  tracking: Map<string, TrackingRecord>,
): { byEntry: Map<string, TrackingRecord>; orphans: TrackingRecord[] } {
  const byEntry = new Map<string, TrackingRecord>()
  const used = new Set<TrackingRecord>()

  for (const entry of entries) {
    const direct = tracking.get(entry.id)
    if (direct) {
      byEntry.set(entry.id, direct)
      used.add(direct)
    }
  }

  const byFile = new Map<string, TrackingRecord>()
  for (const record of tracking.values()) {
    if (used.has(record) || !record.source_file) continue
    byFile.set(record.source_file, record)
  }
  if (byFile.size > 0) {
    for (const entry of entries) {
      if (byEntry.has(entry.id)) continue
      const rescued = byFile.get(path.basename(entry.path))
      if (!rescued) continue
      byEntry.set(entry.id, rescued)
      used.add(rescued)
    }
  }

  return {
    byEntry,
    orphans: [...tracking.values()].filter((record) => !used.has(record)),
  }
}

const TRACKED_FIELDS = ['status', 'severity', 'next_action', 'next_review', 'pinned'] as const

/**
 * Takip kaydını kaydın üstüne bindirir.
 *
 * `overridden` boş dizi olabilir: takip dosyası var ama yalnız not taşıyor.
 * `undefined` ile boş dizi arasındaki fark UI için anlamlıdır — "takibe alınmış
 * ama alan değiştirilmemiş" ile "hiç dokunulmamış" aynı şey değil.
 */
export function applyTracking(entry: Entry, record: TrackingRecord | undefined): Entry {
  if (!record) return entry
  // Değişmez kural: takip dosyası YALNIZ salt-okunur kayıtlar içindir. Yazılabilir
  // bir kayıtta durum kendi frontmatter'ındadır; ikisini birden okumak
  // "düzenledim ama ekranda değişmedi" sınıfı bir hayalet üretirdi.
  if (!entry.readOnly) return entry

  const overridden: string[] = []
  const next: Entry = { ...entry }
  for (const field of TRACKED_FIELDS) {
    const value = record[field]
    if (value === undefined || value === false) continue
    Object.assign(next, { [field]: value })
    overridden.push(field)
  }

  next.overridden = overridden
  next.tracking_note = record.note
  // Durum artık karar; "tahmin" işaretini kaldır ki UI kesikli çerçeve çizmesin.
  if (entry.derived?.length) {
    next.derived = entry.derived.filter((field) => !overridden.includes(field))
  }
  // `updated_at` KAYNAĞIN zamanı olarak kalır; takip dosyasının tazeliği ayrı
  // ölçülür (`status_since`). İkisini birleştirmek "memory dosyası ne zaman
  // değişti" bilgisini yok ederdi.
  if (record.status_since) next.status_since = record.status_since
  return next
}

/**
 * Yamayı mevcut kayda uygular. `null` = alanı temizle, `undefined` = dokunma.
 * Durum gerçekten değiştiyse `status_since` tazelenir — yoksa bayatlık saati
 * her dokunuşta sıfırlanır ve ölçüm anlamını yitirir.
 */
export function mergePatch(
  current: TrackingRecord | undefined,
  patch: TrackingPatch,
  options: {
    id: string
    source?: string
    sourceFile?: string
    by?: 'user' | 'agent'
    now?: Date
  } = { id: '' },
): TrackingRecord {
  const now = options.now ?? new Date()
  const base: TrackingRecord = current ?? {
    tracks: options.id,
    source: options.source,
    source_file: options.sourceFile,
    updated_at: localIso(now),
  }

  const apply = <K extends keyof TrackingRecord>(key: K, value: unknown): void => {
    if (value === undefined) return
    if (value === null || value === '') delete base[key]
    else Object.assign(base, { [key]: value })
  }

  const statusChanged = patch.status !== undefined && patch.status !== base.status
  apply('status', patch.status)
  apply('severity', patch.severity)
  apply('next_action', patch.next_action)
  apply('next_review', patch.next_review)
  apply('note', patch.note)
  if (patch.pinned !== undefined) {
    if (patch.pinned) base.pinned = true
    else delete base.pinned
  }

  if (statusChanged) base.status_since = localIso(now)
  // Açıkça verilen tarih otomatik damgayı EZER: geriye dönük kayıt gerçeği
  // değiştirmemeli.
  if (patch.status_since !== undefined) apply('status_since', patch.status_since)
  base.updated_at = localIso(now)
  if (options.by) base.by = options.by
  if (options.source && !base.source) base.source = options.source
  if (options.sourceFile) base.source_file = options.sourceFile
  return base
}

const KEY_ORDER: Array<keyof TrackingRecord> = [
  'tracks',
  'source',
  'source_file',
  'status',
  'severity',
  'next_action',
  'next_review',
  'pinned',
  'status_since',
  'updated_at',
  'by',
]

export async function writeTracking(
  vaultRoot: string,
  record: TrackingRecord,
): Promise<string> {
  const ordered: Record<string, unknown> = {}
  for (const key of KEY_ORDER) {
    const value = record[key]
    if (value === undefined || value === '' || value === false) continue
    ordered[key] = value
  }
  // Tanımadığımız alanlar sona, olduğu gibi. Daha yeni bir devlog'un yazdığı
  // bir alanı, henüz güncellenmemiş bir araç sessizce silmesin.
  for (const [key, value] of Object.entries(record.extra ?? {})) {
    if (!(key in ordered)) ordered[key] = value
  }
  const absPath = trackingPath(vaultRoot, record.tracks)
  // Alan sırası sabit (`KEY_ORDER`) — bir durumu değiştirmek git diff'inde
  // yalnız gerçekten değişen satırı göstersin.
  const yaml = YAML.stringify(ordered, { lineWidth: 0 })
  await writeFileAtomic(absPath, `---\n${yaml}---\n\n${(record.note ?? '').trim()}\n`)
  return absPath
}

export async function deleteTracking(vaultRoot: string, id: string): Promise<void> {
  await fs.rm(trackingPath(vaultRoot, id), { force: true })
}

export async function deleteTrackingRecord(vaultRoot: string, id: string): Promise<void> {
  await fs.rm(trackingPath(vaultRoot, id), { force: true })
}

/**
 * Yamayı yazılabilir bir kaydın frontmatter'ına uygular.
 * `null` alanı temizler, `undefined` dokunmaz — takip dosyasındaki `mergePatch`
 * ile aynı sözleşme.
 */
export function patchFrontmatter(entry: Entry, patch: TrackingPatch, now = new Date()): EntryFrontmatter {
  const {
    body: _body,
    path: _path,
    sourceId: _sourceId,
    readOnly: _readOnly,
    derived: _derived,
    coerced: _coerced,
    overridden: _overridden,
    tracking_note: _note,
    outboundLinks: _links,
    ...frontmatter
  } = entry

  const next: EntryFrontmatter = { ...frontmatter }
  const set = <K extends keyof EntryFrontmatter>(key: K, value: unknown): void => {
    if (value === undefined) return
    if (value === null || value === '' || value === false) delete next[key]
    else Object.assign(next, { [key]: value })
  }

  const statusChanged = patch.status !== undefined && patch.status !== entry.status
  set('status', patch.status)
  set('severity', patch.severity)
  set('next_action', patch.next_action)
  set('next_review', patch.next_review)
  set('pinned', patch.pinned)
  if (statusChanged) next.status_since = localIso(now)
  if (patch.status_since !== undefined) set('status_since', patch.status_since)
  next.updated_at = localIso(now)
  return next
}

export interface TrackOutcome {
  /** Değişikliğin yazıldığı dosya. */
  path: string
  /** Takip dosyasına mı yazıldı, kaydın kendi frontmatter'ına mı. */
  target: 'tracking' | 'entry'
  /** Yazılan takip kaydı (yalnız `target === 'tracking'`). */
  record?: TrackingRecord
  /** Yeni frontmatter (yalnız `target === 'entry'`). */
  frontmatter?: EntryFrontmatter
  /**
   * Ajan, kullanıcının elle ayarladığı bir durumu değiştirdi. Engellemiyoruz —
   * ajanın canlı kanıtı genelde daha yenidir — ama çağıran bunu bildirmeli ki
   * karar sessizce kaybolmasın.
   */
  overwroteUserDecision: boolean
}

/**
 * Yama diske gitmeden reddedilir: `status_since: 2w` ya da `next_review: "gelecek
 * hafta"` gibi bir değer yazılırsa okuma yolu kaydı geçersiz sayıp gizler ve
 * kullanıcı onu artık CLI'dan bile bulamaz.
 */
function assertValidPatch(patch: TrackingPatch): void {
  const errors: string[] = []
  if (patch.status != null && !(STATUSES as readonly string[]).includes(patch.status)) {
    errors.push(`status: '${patch.status}' tanınmıyor (${STATUSES.join('|')})`)
  }
  if (patch.severity != null && !(SEVERITIES as readonly string[]).includes(patch.severity)) {
    errors.push(`severity: '${patch.severity}' tanınmıyor (${SEVERITIES.join('|')})`)
  }
  if (patch.status_since && Number.isNaN(Date.parse(patch.status_since))) {
    errors.push(`status_since: '${patch.status_since}' geçerli bir tarih değil (YYYY-MM-DD ya da ISO 8601)`)
  }
  if (patch.next_review && !/^\d{4}-\d{2}-\d{2}$/.test(patch.next_review)) {
    errors.push(`next_review: '${patch.next_review}' — YYYY-MM-DD bekleniyor`)
  }
  if (errors.length > 0) throw new Error(errors.join('; '))
}

/**
 * Takip alanlarını değiştiren TEK yol. Masaüstü, CLI ve MCP aynı fonksiyonu
 * çağırır; "CLI'da oldu ama uygulamada olmadı" sınıfı tutarsızlık imkânsız.
 *
 * Yönlendirme kaydın yazılabilirliğine göre:
 * - yazılabilir kayıt → kendi frontmatter'ı (tek gerçek orada kalır),
 * - salt-okunur ayna  → `tracking/<id>.md`, kaynağa tek bayt dokunulmaz.
 */
export async function trackEntry(
  vaultRoot: string,
  entry: Entry,
  patch: TrackingPatch,
  by: 'user' | 'agent' = 'user',
): Promise<TrackOutcome> {
  assertValidPatch(patch)
  if (!entry.readOnly) {
    const frontmatter = patchFrontmatter(entry, patch)
    const written = await writeEntry(vaultRoot, frontmatter, entry.body, entry.path)
    // Yazılabilir kayıtta ikinci bir gerçek bırakma: geçmişten kalmış bir takip
    // dosyası varsa okuma yolunda yok sayılıyor, diskte de durmasın.
    await deleteTrackingRecord(vaultRoot, entry.id)
    return { path: written, target: 'entry', frontmatter, overwroteUserDecision: false }
  }

  // Diskten okuyoruz, çağıranın elindeki kopyadan değil: aynı dosyaya üç araç
  // yazıyor ve aradaki bir değişikliği sessizce ezmek, verilmiş bir kararı yok
  // etmek demek.
  const current = await readTracking(trackingPath(vaultRoot, entry.id))
  const overwroteUserDecision =
    by === 'agent' &&
    current?.by === 'user' &&
    patch.status !== undefined &&
    patch.status !== current.status

  const record = mergePatch(current ?? undefined, patch, {
    id: entry.id,
    source: entry.sourceId,
    sourceFile: path.basename(entry.path),
    by,
  })
  const written = await writeTracking(vaultRoot, record)
  return { path: written, target: 'tracking', record, overwroteUserDecision }
}
