import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { EntryStatus, SourceInfo } from './types.js'

/**
 * Paylaşılan yapılandırma.
 *
 * Masaüstü uygulaması, `devlog` CLI'ı, MCP sunucusu ve Claude Code hook'ları
 * AYNI vault'u bulmak zorunda. Bu yüzden config platforma özel bir userData
 * dizininde değil, herkesin okuyabileceği tek bir yerde duruyor:
 * `~/.devlog/config.json`.
 */

export interface DevlogConfig {
  vaultRoot: string
  /** Salt-okunur aynalar. */
  sources: SourceInfo[]
  /** Hızlı yakalama kısayolu (yalnız masaüstü uygulaması kullanır). */
  hotkey?: string
  /** Görünüm tercihleri — pencere durumu DEĞİL, karar olan şeyler. */
  ui?: UiConfig
  /** Bayatlık eşikleri; ajan ve insan aynı şeye "bayat" desin diye burada. */
  tracking?: { staleAfterDays?: Partial<Record<EntryStatus, number>> }
  /** Takım vault'ları — her biri ayrı, private bir GitHub reposunun klonu. */
  teams?: TeamConfig[]
}

/**
 * Takım vault'u: ekibin ortak feed'i.
 *
 * Kişisel vault BİLİNÇLİ olarak remote'suz (canlı güvenlik bulguları taşıyor);
 * takım feed'i onu paylaşmak yerine yanına ayrı bir depo olarak eklenir. Sunucu
 * yok: taşıyıcı GitHub, eşitleme düz `git fetch/rebase/push`.
 */
export interface TeamConfig {
  /** Kısa, dosya adına uygun kimlik (`ekip`). Kaynak id'si `team:<id>` olur. */
  id: string
  label: string
  /** Yerel klonun yolu. */
  root: string
  /** Bilgi amaçlı; klonun kendi `origin`'i esastır. */
  remote?: string
  /** Bu takımda BENİM yazar adım — kayıtlara `author` olarak yazılır. */
  author: string
  /**
   * Commit/deploy kayıtları bu kod depolarından geliyorsa takıma gider.
   * Değer: depo adı (`maestro`), mutlak yol ya da `sahip/depo`.
   * Oturum özetleri HİÇBİR koşulda takıma gitmez — promptlarını taşırlar.
   */
  repos?: string[]
  enabled?: boolean
}

export interface UiConfig {
  /** `system` (işletim sistemini izler) ya da bir tema id'si. */
  theme?: string
  /** Vurgu rengi id'si. */
  accent?: string
  /** Arayüz yazı tipi. */
  font?: 'jakarta' | 'sistem'
  /** Detay panelinin yeri. */
  layout?: 'sag' | 'alt'
  /** Uygulama hangi kiple açılsın. `resume` = bıraktığın yer. */
  startup?: 'list' | 'tracker' | 'resume'
  /** Liste satırı yoğunluğu. */
  density?: 'compact' | 'comfortable'
}

export function configPath(): string {
  return process.env['DEVLOG_CONFIG'] ?? path.join(os.homedir(), '.devlog', 'config.json')
}

export function defaultVaultRoot(): string {
  return path.join(os.homedir(), 'devlog-vault')
}

/** `-Users-alice-code-MyApp` → `MyApp` */
function projectLabel(encodedDir: string): string {
  return encodedDir.split('-').filter(Boolean).at(-1) ?? encodedDir
}

/**
 * Claude Code memory köklerini bulur: `~/.claude/projects/<proje>/memory`.
 * İlk açılışta kullanıcı hiçbir şey ayarlamadan mevcut notlarını görsün diye.
 */
export async function discoverClaudeMemorySources(): Promise<SourceInfo[]> {
  const projectsDir = path.join(os.homedir(), '.claude', 'projects')
  let dirs: string[]
  try {
    const items = await fs.readdir(projectsDir, { withFileTypes: true })
    dirs = items.filter((item) => item.isDirectory()).map((item) => item.name)
  } catch {
    return []
  }

  const found: SourceInfo[] = []
  for (const dir of dirs) {
    const root = path.join(projectsDir, dir, 'memory')
    try {
      if (!(await fs.stat(root)).isDirectory()) continue
    } catch {
      continue
    }
    found.push({
      id: `claude-memory:${dir}`,
      label: `Claude · ${projectLabel(dir)}`,
      root,
      readOnly: true,
      dialect: 'claude-memory',
    })
  }
  return found.sort((a, b) => a.label.localeCompare(b.label, 'tr'))
}

function isSourceInfo(value: unknown): value is SourceInfo {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return (
    typeof v.id === 'string' &&
    typeof v.label === 'string' &&
    typeof v.root === 'string' &&
    typeof v.readOnly === 'boolean' &&
    (v.dialect === 'devlog' || v.dialect === 'claude-memory')
  )
}

/** `ekip`, `mobil-ekip` — dosya adına ve git dal adına güvenle girer. */
export const TEAM_ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/

function parseTeams(value: unknown): TeamConfig[] | undefined {
  if (!Array.isArray(value)) return undefined
  const teams: TeamConfig[] = []
  for (const raw of value) {
    const v = asRecord(raw)
    if (typeof v.id !== 'string' || !TEAM_ID_RE.test(v.id)) continue
    if (typeof v.root !== 'string' || !v.root.trim()) continue
    if (typeof v.author !== 'string' || !v.author.trim()) continue
    if (teams.some((team) => team.id === v.id)) continue
    teams.push({
      id: v.id,
      label: typeof v.label === 'string' && v.label.trim() ? v.label.trim() : v.id,
      root: expandHome(v.root),
      remote: typeof v.remote === 'string' ? v.remote : undefined,
      author: v.author.trim(),
      repos: Array.isArray(v.repos) ? v.repos.filter((r): r is string => typeof r === 'string') : undefined,
      enabled: typeof v.enabled === 'boolean' ? v.enabled : undefined,
    })
  }
  return teams.length > 0 ? teams : undefined
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

function parseUi(value: unknown): UiConfig | undefined {
  const raw = asRecord(value)
  const ui: UiConfig = {}
  if (typeof raw.theme === 'string' && raw.theme.trim()) ui.theme = raw.theme.trim()
  if (typeof raw.accent === 'string' && raw.accent.trim()) ui.accent = raw.accent.trim()
  if (raw.font === 'jakarta' || raw.font === 'sistem') ui.font = raw.font
  if (raw.layout === 'sag' || raw.layout === 'alt') ui.layout = raw.layout
  if (raw.startup === 'list' || raw.startup === 'tracker' || raw.startup === 'resume') {
    ui.startup = raw.startup
  }
  if (raw.density === 'compact' || raw.density === 'comfortable') ui.density = raw.density
  return Object.keys(ui).length > 0 ? ui : undefined
}

function parseTracking(value: unknown): DevlogConfig['tracking'] {
  const days = asRecord(asRecord(value).staleAfterDays)
  const out: Partial<Record<EntryStatus, number>> = {}
  for (const [key, raw] of Object.entries(days)) {
    if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) {
      out[key as EntryStatus] = Math.round(raw)
    }
  }
  return Object.keys(out).length > 0 ? { staleAfterDays: out } : undefined
}

/**
 * `~/notlar` ve göreli yollar mutlak hâle getirilir. Hook'lar her projenin
 * kendi dizininde çalışıyor: açılmamış bir `~` vault'u o projenin içine
 * `./~/…` olarak saçar ve yanlışlıkla commit'lenebilirdi.
 */
export function expandHome(value: string): string {
  if (value === '~') return os.homedir()
  if (value.startsWith('~/') || value.startsWith('~\\')) return path.join(os.homedir(), value.slice(2))
  return path.resolve(value)
}

type StoredConfig =
  | { state: 'ok'; data: Record<string, unknown> }
  | { state: 'missing' }
  | { state: 'corrupt'; error: string }

async function readStored(target: string): Promise<StoredConfig> {
  let raw: string
  try {
    raw = await fs.readFile(target, 'utf8')
  } catch {
    return { state: 'missing' }
  }
  try {
    const data = JSON.parse(raw) as unknown
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      return { state: 'ok', data: data as Record<string, unknown> }
    }
    return { state: 'corrupt', error: 'kök bir JSON nesnesi değil' }
  } catch (error) {
    return { state: 'corrupt', error: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * Saklanan kaynaklar + şu an diskte bulunan Claude memory kökleri.
 *
 * Saklanan liste kullanıcının KARARLARINI (kapattığı kökler, elle eklediği
 * kaynaklar) taşır, keşfin yerini almaz: aksi hâlde ayarlar bir kez
 * kaydedildiğinde liste donar ve sonradan açılan projeler hiç görünmezdi.
 */
async function mergeSources(stored: unknown): Promise<SourceInfo[]> {
  const discovered = await discoverClaudeMemorySources()
  if (!Array.isArray(stored)) return discovered
  const kept = stored.filter(isSourceInfo)
  const known = new Set(kept.map((source) => source.id))
  return [...kept, ...discovered.filter((source) => !known.has(source.id))]
}

export async function loadConfig(): Promise<DevlogConfig> {
  const read = await readStored(configPath())
  if (read.state === 'corrupt') {
    // Sessizce varsayılana düşmek, kullanıcının vault'u "boşaldı" sanmasına
    // yol açar. Uyarı stderr'e — MCP'nin stdout'u protokol kanalı.
    process.stderr.write(`[devlog] ${configPath()} okunamadı (${read.error}); varsayılanlar kullanılıyor.\n`)
  }
  const stored = read.state === 'ok' ? read.data : {}

  // `DEVLOG_VAULT` her şeyi ezer: hook'lar ve testler için tek kaçış kapısı.
  const vaultRoot = expandHome(
    process.env['DEVLOG_VAULT'] ??
      (typeof stored.vaultRoot === 'string' && stored.vaultRoot.trim()
        ? stored.vaultRoot
        : defaultVaultRoot()),
  )

  return {
    vaultRoot,
    sources: await mergeSources(stored.sources),
    hotkey: typeof stored.hotkey === 'string' ? stored.hotkey : undefined,
    ui: parseUi(stored.ui),
    tracking: parseTracking(stored.tracking),
    teams: parseTeams(stored.teams),
  }
}

/**
 * Yazma yolu oku-değiştir-yaz: TANIMADIĞIMIZ anahtarlar olduğu gibi korunur.
 *
 * Aksi hâlde daha yeni bir devlog'un yazdığı bir ayar, henüz güncellenmemiş bir
 * araç (CLI ve MCP ayrı derleniyor) config'i her kaydettiğinde sessizce silinir.
 * Aynı sınıf hata takip dosyalarında da vardı; orada da böyle çözüldü.
 */
export async function saveConfig(config: DevlogConfig): Promise<void> {
  const target = configPath()
  const read = await readStored(target)
  const existing = read.state === 'ok' ? read.data : {}
  if (read.state === 'corrupt') {
    // Elle düzenlenip bozulmuş dosyayı (sondaki virgül vb.) ezmeden önce sakla;
    // içindeki vaultRoot ve kaynaklar kullanıcının emeği.
    await fs.copyFile(target, `${target}.bozuk-${Date.now()}`)
  }
  const merged: Record<string, unknown> = { ...existing, ...config }
  for (const key of ['ui', 'tracking'] as const) {
    if (config[key] === undefined) delete merged[key]
  }
  await fs.mkdir(path.dirname(target), { recursive: true })
  await fs.writeFile(target, `${JSON.stringify(merged, null, 2)}\n`, 'utf8')
}

/** Takım kaynağı: yazılabilir, ama yalnız `author`'ı ben olan kayıtlar. */
export function teamSource(team: TeamConfig): SourceInfo {
  return {
    id: `team:${team.id}`,
    label: team.label,
    root: team.root,
    readOnly: false,
    dialect: 'devlog',
    owner: team.author,
    team: team.id,
    enabled: team.enabled,
  }
}

/** Açık takımlar. */
export function activeTeams(config: DevlogConfig): TeamConfig[] {
  return (config.teams ?? []).filter((team) => team.enabled !== false)
}

/** Yazılabilir vault her zaman kaynak listesinin başında durur. */
export function vaultSource(vaultRoot: string): SourceInfo {
  return {
    id: 'vault',
    label: 'Seyir defteri',
    root: vaultRoot,
    readOnly: false,
    dialect: 'devlog',
  }
}
