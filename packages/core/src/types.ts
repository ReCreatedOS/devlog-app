/**
 * Kayıt (Entry) veri modeli.
 *
 * Tek kaynak: diskteki markdown dosyası. Buradaki tipler o dosyanın
 * frontmatter kontratını ve uygulamanın türettiği ek alanları tanımlar.
 * İndekste yaşayan hiçbir veri yoktur — her şey markdown'dan yeniden üretilebilir.
 */

export const ENTRY_TYPES = [
  'incident',
  'security',
  'devlog',
  'update',
  'idea',
  'decision',
  'deploy',
  'commit',
  'meeting',
  'note',
] as const
export type EntryType = (typeof ENTRY_TYPES)[number]

export const SEVERITIES = ['critical', 'high', 'medium', 'low', 'info'] as const
export type Severity = (typeof SEVERITIES)[number]

export const STATUSES = [
  'open',
  'in-progress',
  'blocked',
  'verified',
  'monitoring',
  'fixed',
  'done',
  'wontfix',
] as const
export type EntryStatus = (typeof STATUSES)[number]

/** `severity` yalnız bu türler için zorunludur. */
export const SEVERITY_REQUIRED_TYPES: readonly EntryType[] = ['incident', 'security']

export interface EntryRefs {
  commits?: string[]
  files?: string[]
  links?: string[]
  urls?: string[]
}

/** Dosyanın YAML frontmatter'ında birebir duran alanlar. */
export interface EntryFrontmatter {
  id: string
  title: string
  type: EntryType
  severity?: Severity
  status?: EntryStatus
  /** OLAYIN zamanı — kaydın yazıldığı an değil. Kronolojik sıralama bunun üstünden. */
  occurred_at: string
  created_at: string
  updated_at?: string
  /**
   * Takım vault'larında kaydı kimin yazdığı. Her kişi yalnız KENDİ kayıtlarını
   * yazar; böylece iki kişi aynı dosyaya hiç dokunmaz ve git eşitlemesi asla
   * içerik çakışmasına düşmez. Kişisel vault'ta boş kalır.
   */
  author?: string
  project?: string
  area?: string
  tags?: string[]
  refs?: EntryRefs
  /**
   * Durumun en son DEĞİŞTİĞİ an. Bayatlık bunun üstünden ölçülür: kaydın kendisi
   * eski olabilir ama durumu dün değişmiş olabilir.
   */
  status_since?: string
  /** Sıradaki somut adım — tek cümle. Durumu olan ama adımı olmayan kayıt takip edilemez. */
  next_action?: string
  /** `YYYY-MM-DD` — bu gün geldiğinde kayıt takip listesinin başına çıkar. */
  next_review?: string
  /** Takip listesinde yukarıda dursun. */
  pinned?: boolean
}

/** Bir kaynak kökü: yazılabilir vault ya da salt-okunur ayna. */
export interface SourceInfo {
  id: string
  label: string
  root: string
  readOnly: boolean
  /** Ayrıştırma lehçesi. `devlog` = bizim şemamız, diğerleri adaptörden gelir. */
  dialect: 'devlog' | 'claude-memory'
  /**
   * Takım kaynaklarında BENİM yazar adım. Kaynak yazılabilir olsa da `author`'ı
   * bu olmayan kayıtlar salt-okunur okunur — başkasının dosyasını düzenlemek
   * eşitlemede çakışma üretirdi. Durumunu ise yine de kendi takip dosyanla
   * izleyebilirsin (kişisel vault'a yazılır, takıma gitmez).
   */
  owner?: string
  /** Takım kaynağıysa takımın id'si — eşitleme ve yönlendirme bunun üstünden. */
  team?: string
  /**
   * Kapalı kaynak taranmaz. Alan yoksa AÇIK sayılır — eski config dosyaları
   * bir anda tüm kaynaklarını kaybetmesin.
   */
  enabled?: boolean
}

export interface Entry extends EntryFrontmatter {
  body: string
  /** Diskteki mutlak yol. */
  path: string
  sourceId: string
  readOnly: boolean
  /**
   * Dosyada yazmayan, adaptörün çıkardığı alanlar. UI bunları "tahmin" olarak
   * kesikli çerçeveyle gösterir — kaynağa hiçbir şey yazılmaz.
   */
  derived?: string[]
  /**
   * Şema kurtarması sırasında değiştirilen alanlar — dosyada YAZAN ama
   * tanımadığımız bir değeri güvenli karşılığına çektiğimiz yerler. `derived`
   * ile karıştırılmamalı: orada alan hiç yoktu, burada vardı ama anlaşılmadı.
   */
  coerced?: string[]
  /**
   * Takip dosyasından gelen, kaynağın üstüne binen alanlar. `derived`'ın tersi:
   * bunlar tahmin değil, kullanıcının (ya da ajanın) verdiği karardır.
   */
  overridden?: string[]
  /** Takip dosyasının gövdesi: kullanıcının kendi notu. Kaynağın gövdesine karışmaz. */
  tracking_note?: string
  /** Gövdeden çıkarılan `[[wikilink]]` hedefleri. */
  outboundLinks?: string[]
}

export type EntrySummary = Omit<Entry, 'body'> & { excerpt: string }

/** `relevance` yalnız metin araması varsa anlamlıdır; yoksa `newest` gibi davranır. */
export type SortOrder = 'newest' | 'oldest' | 'relevance'

export interface QueryFilter {
  text?: string
  types?: EntryType[]
  severities?: Severity[]
  statuses?: EntryStatus[]
  tags?: string[]
  sources?: string[]
  /** ISO tarih (dahil). */
  from?: string
  /** ISO tarih (dahil). */
  to?: string
  /** Yalnız bayatlamış kayıtlar: aktif durumda ama eşiği aşmış. */
  stale?: boolean
  sort?: SortOrder
}

export interface Facets {
  types: Record<string, number>
  sources: Record<string, number>
  statuses: Record<string, number>
  severities: Record<string, number>
  tags: Array<{ tag: string; count: number }>
  /** `YYYY-MM-DD` → o güne düşen kayıt sayısı. Takvim ısı görünümü bunu kullanır. */
  days: Record<string, number>
}

export interface QueryResult {
  items: EntrySummary[]
  total: number
  facets: Facets
}

export interface EntryDraft {
  title: string
  type: EntryType
  body: string
  /**
   * Hedef takım id'si. Dosyaya YAZILMAZ — yalnız yönlendirmedir
   * (`createRoutedEntry`). Verilmezse kayıt kişisel vault'a düşer.
   */
  team?: string
  /** Takım kaydında yazar; `createRoutedEntry` takım ayarından doldurur. */
  author?: string
  severity?: Severity
  status?: EntryStatus
  occurred_at?: string
  project?: string
  area?: string
  tags?: string[]
  refs?: EntryRefs
  next_action?: string
  next_review?: string
  pinned?: boolean
}

/**
 * Takip alanlarında yapılan değişiklik. `undefined` = dokunma, `null` = temizle.
 *
 * Bu ayrım şart: "durumu kaldır" ile "durumu değiştirme" aynı çağrıya sığmalı,
 * yoksa bir alanı geri boşaltmanın yolu kalmaz.
 */
export interface TrackingPatch {
  status?: EntryStatus | null
  /**
   * Durumun ne zamandan beri böyle olduğu. Verilmezse durum değiştiğinde
   * "şimdi" damgalanır. Geriye dönük doğru: bir bulgu 68 gündür açıksa bunu
   * bugün kayda geçirmen onu taze yapmaz.
   */
  status_since?: string | null
  severity?: Severity | null
  next_action?: string | null
  next_review?: string | null
  pinned?: boolean | null
  note?: string | null
}
