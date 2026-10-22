// `@devlog/core` yerine `/shared`: bu dosya hem ana süreçten hem renderer'dan
// import ediliyor ve kök yüzey node-only modülleri (vault, sources) çekiyor.
import type {
  Entry,
  EntryDraft,
  EntryFrontmatter,
  EntrySummary,
  Facets,
  QueryFilter,
  QueryResult,
  EntryStatus,
  SourceInfo,
  TrackingPatch,
} from '@devlog/core/shared'

/** Şemaya uymayan bir dosya — sessizce yutmak yerine UI'da gösterilir. */
export interface ReadFailureInfo {
  path: string
  errors: string[]
}

/** Ayarlar ekranının okuduğu ve yazdığı yüzey. */
export interface AppSettings {
  /** `system` ya da bir tema id'si (`gece`, `murekkep`, `gun`…). */
  theme: string
  /** Vurgu rengi id'si — temadan bağımsız eksen. */
  accent: string
  /** Arayüz yazı tipi. */
  font: 'jakarta' | 'sistem'
  /** Detay panelinin yeri. */
  layout: 'sag' | 'alt'
  startup: 'list' | 'tracker' | 'resume'
  density: 'compact' | 'comfortable'
  hotkey: string
  /**
   * Kısayol işletim sisteminden gerçekten alınabildi mi. `false` ise başka bir
   * uygulama tutuyor demektir — ayar dosyasında yazması çalıştığı anlamına gelmez.
   */
  hotkeyRegistered: boolean
  /** Yalnız aktif durumlar ayarlanabilir; kapanmışlar sonsuz. */
  staleAfterDays: Partial<Record<EntryStatus, number>>
  vaultRoot: string
  sources: Array<SourceInfo & { count: number }>
}

export interface LibraryStatus {
  indexing: boolean
  count: number
  vaultRoot: string
  sources: Array<SourceInfo & { count: number }>
  /** Bayatlık eşikleri — renderer aynı hesabı yapabilsin diye. */
  staleAfterDays: Partial<Record<EntryStatus, number>>
  failures: ReadFailureInfo[]
  /** Takip dosyası olan kayıt sayısı. */
  tracked: number
  /** Hedefi kaybolmuş takip dosyaları — kaynak silinmiş ya da yeniden adlandırılmış. */
  orphanTracking: string[]
  /** Aynı id'yi iki kaynakta gören kayıtlar — biri sessizce düşürüldü. */
  collisions: string[]
}

export interface EntryDetail {
  entry: Entry
  backlinks: EntrySummary[]
}

export type SaveOutcome =
  | { ok: true; entry: Entry }
  | { ok: false; reason: 'conflict'; current: Entry }
  | { ok: false; reason: 'readonly' | 'missing' | 'invalid'; message: string }

export type CaptureOutcome = { ok: true; id: string } | { ok: false; message: string }

export const CHANNELS = {
  query: 'devlog:query',
  facets: 'devlog:facets',
  detail: 'devlog:detail',
  create: 'devlog:create',
  save: 'devlog:save',
  track: 'devlog:track',
  remove: 'devlog:remove',
  status: 'devlog:status',
  settings: 'devlog:settings',
  updateSettings: 'devlog:update-settings',
  reindex: 'devlog:reindex',
  resolve: 'devlog:resolve',
  reveal: 'devlog:reveal',
  openExternal: 'devlog:open-external',
  changed: 'devlog:changed',
  statusChanged: 'devlog:status-changed',
  focusEntry: 'devlog:focus-entry',
  newEntry: 'devlog:new-entry',
  captureSubmit: 'capture:submit',
  captureClose: 'capture:close',
  captureResize: 'capture:resize',
  captureOpenMain: 'capture:open-main',
} as const

export interface DevlogApi {
  query(filter: QueryFilter, limit?: number, offset?: number): Promise<QueryResult>
  facets(): Promise<Facets>
  detail(id: string): Promise<EntryDetail | null>
  create(draft: EntryDraft): Promise<Entry>
  save(
    id: string,
    frontmatter: EntryFrontmatter,
    body: string,
    baseUpdatedAt?: string,
  ): Promise<SaveOutcome>
  /**
   * Takip alanlarını değiştirir. Salt-okunur aynadaki kayıtlarda da çalışır —
   * değişiklik vault'taki takip dosyasına yazılır, kaynağa dokunulmaz.
   */
  track(id: string, patch: TrackingPatch): Promise<Entry | null>
  remove(id: string): Promise<boolean>
  status(): Promise<LibraryStatus>
  /** Ayarları okur (config.json + hesaplanmış sayaçlar). */
  settings(): Promise<AppSettings>
  /** Verilen alanları günceller ve etkisini hemen uygular. */
  updateSettings(patch: Partial<AppSettings>): Promise<AppSettings>
  reindex(): Promise<void>
  /** `[[link]]` hedeflerinin karşılığı var mı — çözülemeyen bağlantılar kesikli gösterilir. */
  resolve(ids: string[]): Promise<Record<string, boolean>>
  reveal(id: string): Promise<void>
  openExternal(url: string): Promise<void>
  /** Dönüş değeri aboneliği iptal eder. */
  onChanged(callback: (id?: string) => void): () => void
  onStatusChanged(callback: () => void): () => void
  /** Hızlı yakalamadan ya da menüden bir kayda odaklanma isteği geldi. */
  onFocusEntry(callback: (id: string) => void): () => void
  /** Menüden "Yeni kayıt" seçildi. */
  onNewEntry(callback: () => void): () => void
  capture: {
    submit(text: string): Promise<CaptureOutcome>
    close(): void
    resize(height: number): void
    openMain(id?: string): void
  }
  platform: string
}
