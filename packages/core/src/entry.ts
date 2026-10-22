/**
 * Saf (node bağımsız) kayıt yardımcıları. Renderer da bunları kullanabilsin diye
 * dosya sistemine dokunan her şey `vault.ts`'te ayrı tutuluyor.
 */
import { extractWikilinks } from './frontmatter.js'
import { slugify } from './fold.js'
import type { Entry, EntryFrontmatter, EntrySummary } from './types.js'

const pad = (n: number, width = 2): string => String(n).padStart(width, '0')

/** Yerel saat dilimini koruyan ISO damgası (`2026-07-30T14:32:00+03:00`). */
export function localIso(date: Date = new Date()): string {
  const offsetMin = -date.getTimezoneOffset()
  const sign = offsetMin >= 0 ? '+' : '-'
  const abs = Math.abs(offsetMin)
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  )
}

/**
 * Kronolojik sıralama için epoch ms.
 *
 * Kaynaklar farklı zaman biçimleri üretiyor: vault `+03:00` yazar, Claude
 * memory'nin `metadata.modified`'ı UTC `Z`, gövdeden çıkarılan tarihler ise
 * ofsetsiz. **Dizge karşılaştırması bunları yanlış sıralar** —
 * `"…T20:36:28.272Z"` < `"…T23:25:22+03:00"` çıkar ama 20:36Z aslında yerel
 * 23:36'dır, yani daha YENİ. Her karşılaştırma buradan geçmeli.
 */
export function occurredAtMs(iso: string): number {
  const parsed = Date.parse(iso)
  return Number.isNaN(parsed) ? 0 : parsed
}

/** Yerel güne göre `YYYY-MM-DD`. Gün gruplaması ve takvim bunu kullanır. */
export function localDayKey(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '0000-00-00'
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** `2026-07-30-1432-api-gateway-deploy` — dosya adının gövdesi ve değişmez kimlik. */
export function makeEntryId(occurredAt: Date, title: string): string {
  const stamp =
    `${occurredAt.getFullYear()}-${pad(occurredAt.getMonth() + 1)}-${pad(occurredAt.getDate())}` +
    `-${pad(occurredAt.getHours())}${pad(occurredAt.getMinutes())}`
  return `${stamp}-${slugify(title)}`
}

const ID_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})-\d{4}-/

/** `entries/2026/07/<id>.md` — tarih bölmeli dizinler klasörleri küçük tutar. */
export function entryRelativePath(id: string): string {
  const match = ID_DATE_RE.exec(id)
  if (!match) return `entries/diger/${id}.md`
  return `entries/${match[1]}/${match[2]}/${id}.md`
}

export function toExcerpt(body: string, max = 180): string {
  const flat = body
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/^\s*[#>*-]+\s*/gm, '')
    .replace(/\[\[([^\]|]+?)(?:\|[^\]]*)?\]\]/g, '$1')
    .replace(/[*_`]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return flat.length <= max ? flat : `${flat.slice(0, max).trimEnd()}…`
}

export interface EntryOrigin {
  sourceId: string
  readOnly: boolean
  derived?: string[]
  coerced?: string[]
}

export function toEntry(
  frontmatter: EntryFrontmatter,
  body: string,
  absPath: string,
  origin: EntryOrigin,
): Entry {
  return {
    ...frontmatter,
    body,
    path: absPath,
    sourceId: origin.sourceId,
    readOnly: origin.readOnly,
    derived: origin.derived,
    coerced: origin.coerced,
    outboundLinks: extractWikilinks(body),
  }
}

export function toSummary(entry: Entry): EntrySummary {
  const { body, ...rest } = entry
  return { ...rest, excerpt: toExcerpt(body) }
}
