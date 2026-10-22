/**
 * Takip katmanı — bir kaydın ŞİMDİKİ hâli.
 *
 * Defterin geri kalanı geçmiş zamandır: "şu gün şu oldu". Takip ise şimdiki
 * zamandır: "bu konu hâlâ açık ve 34 gündür kimse dokunmadı". Ayrı bir dosyada
 * durmasının sebebi bu ayrım — buradaki hiçbir şey bir olayı anlatmaz, hepsi
 * bugüne bakar.
 */
import { occurredAtMs } from './entry.js'
import type { EntryFrontmatter, EntryStatus } from './types.js'

/**
 * Takip hesabı için gereken en dar yüzey. `Entry` de `EntrySummary` de bunu
 * karşılar — gövdeyi taşımayan liste satırları da aynı fonksiyonlardan geçsin.
 */
export type Trackable = Pick<
  EntryFrontmatter,
  'status' | 'severity' | 'occurred_at' | 'updated_at' | 'status_since' | 'next_review' | 'pinned'
>

/** İş bitmemiş durumlar — takip görünümü yalnız bunları gösterir. */
export const ACTIVE_STATUSES: readonly EntryStatus[] = [
  'open',
  'in-progress',
  'blocked',
  'monitoring',
]

/** Kapanmış durumlar. `verified` burada: doğrulanmış bir bulgu artık takipte değil. */
export const TERMINAL_STATUSES: readonly EntryStatus[] = ['verified', 'fixed', 'done', 'wontfix']

export function isActiveStatus(status: EntryStatus | undefined): boolean {
  return status !== undefined && ACTIVE_STATUSES.includes(status)
}

/**
 * Bir durumun ne kadar sessiz kalabileceği. Aşılırsa kayıt "bayat" sayılır.
 *
 * Eşikler duruma göre farklı, çünkü sessizliğin anlamı duruma göre değişiyor:
 * üzerinde çalışılan bir iş bir hafta kıpırdamıyorsa gerçekte durmuştur;
 * izlemedeki bir düzeltmenin bir ay ses çıkarmaması ise normaldir.
 */
export const DEFAULT_STALE_AFTER_DAYS: Record<EntryStatus, number> = {
  open: 14,
  'in-progress': 7,
  blocked: 30,
  monitoring: 30,
  // Kapanmış durumlar bilinçli olarak AYARLANAMAZ: düzeltilmiş bir kaydın bir
  // gün "bayatlaması" mekanizmanın anlamını silerdi.
  verified: Number.POSITIVE_INFINITY,
  fixed: Number.POSITIVE_INFINITY,
  done: Number.POSITIVE_INFINITY,
  wontfix: Number.POSITIVE_INFINITY,
}

export const STALE_AFTER_DAYS: Record<EntryStatus, number> = { ...DEFAULT_STALE_AFTER_DAYS }

/**
 * Eşikleri ayarlardan kurar. Süreç başına bir kez, config okunduktan sonra
 * çağrılır (masaüstü ana süreç, renderer, CLI ve MCP ayrı ayrı).
 *
 * Modül düzeyinde tek bir tablo tutmanın sebebi: aksi hâlde `trackingState`
 * her çağrıda eşik parametresi isterdi ve bir çağıranın onu geçmeyi unutması,
 * ajanla insanın farklı şeye "bayat" demesi demek olurdu.
 */
export function configureStaleThresholds(
  overrides: Partial<Record<EntryStatus, number>> | undefined,
): void {
  Object.assign(STALE_AFTER_DAYS, DEFAULT_STALE_AFTER_DAYS)
  if (!overrides) return
  for (const status of ACTIVE_STATUSES) {
    const value = overrides[status]
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      STALE_AFTER_DAYS[status] = Math.round(value)
    }
  }
}

const DAY_MS = 86_400_000

export interface TrackingState {
  /** Takip edilmeye devam eden bir kayıt mı. */
  active: boolean
  /** Bu duruma girdiğinden beri geçen tam gün sayısı. */
  ageDays: number
  /** Eşiği aştı: kimse dokunmuyor. */
  stale: boolean
  /** Bu durum için eşik (gün). UI bunu gösterir — sihirli sayı görünmez kalmasın. */
  thresholdDays: number
  /** `next_review` günü geldi ya da geçti. */
  reviewDue: boolean
}

/**
 * Yaş, durumun DEĞİŞTİĞİ ana göre ölçülür (`status_since`); o yoksa olayın
 * kendi tarihine (`occurred_at`) düşer.
 *
 * `updated_at` bu hesaba ASLA girmez. Ayna kayıtlarında o alan memory
 * dosyasının değişim zamanıdır: ajan 40 gündür açık duran bir bulguya tek satır
 * eklediğinde kayıt "taze" görünür ve bayatlık ölçümü tam da ölçmesi gereken
 * şeyi kaçırırdı.
 */
export function trackingState(entry: Trackable, now: Date = new Date()): TrackingState {
  const active = isActiveStatus(entry.status)
  const since = entry.status_since ?? entry.occurred_at
  const ageDays = Math.max(0, Math.floor((now.getTime() - occurredAtMs(since)) / DAY_MS))
  const threshold = entry.status ? STALE_AFTER_DAYS[entry.status] : Number.POSITIVE_INFINITY

  return {
    active,
    ageDays,
    thresholdDays: threshold,
    stale: active && ageDays > threshold,
    reviewDue: active && entry.next_review !== undefined && entry.next_review <= dayKeyOf(now),
  }
}

function dayKeyOf(date: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/**
 * Takip listesinin sırası: gözden geçirme günü gelenler → bayatlar → sabitlenmişler
 * → severity → yaş. Amaç, listenin ilk satırının her zaman "bugün bakılması
 * gereken şey" olması.
 */
const SEVERITY_RANK: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
}

export function compareTracked(a: Trackable, b: Trackable, now: Date = new Date()): number {
  const sa = trackingState(a, now)
  const sb = trackingState(b, now)
  if (sa.reviewDue !== sb.reviewDue) return sa.reviewDue ? -1 : 1
  if (sa.stale !== sb.stale) return sa.stale ? -1 : 1
  if (Boolean(a.pinned) !== Boolean(b.pinned)) return a.pinned ? -1 : 1
  const rank = (SEVERITY_RANK[a.severity ?? ''] ?? 9) - (SEVERITY_RANK[b.severity ?? ''] ?? 9)
  if (rank !== 0) return rank
  return sb.ageDays - sa.ageDays
}
