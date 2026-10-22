import MiniSearch from 'minisearch'
import { localDayKey, occurredAtMs, toSummary } from './entry.js'
import { fold } from './fold.js'
import { trackingState } from './tracking.js'
import type { Entry, EntrySummary, Facets, QueryFilter, QueryResult } from './types.js'

/**
 * Arama indeksi arayüzü.
 *
 * Bu indekste **yalnız türetilmiş veri** yaşar; kaynak daima diskteki markdown.
 * Bozulursa/silinirse `replaceAll` ile birkaç yüz ms'de yeniden kurulur.
 * Korpus ~20.000 kaydı geçerse arkasına SQLite FTS5 implementasyonu konur —
 * çağıranlar bu arayüzü kullandığı için değişiklik tek dosyalıktır.
 */
export interface SearchIndex {
  replaceAll(entries: Entry[]): void
  upsert(entry: Entry): void
  remove(id: string): void
  get(id: string): Entry | undefined
  /** Bindirilmiş hâlleriyle tüm kayıtlar — yeniden eşleme yapan yollar için. */
  all(): Entry[]
  query(filter: QueryFilter, limit?: number, offset?: number): QueryResult
  /** Bu kayda `[[link]]` ile bağlanan kayıtlar. */
  backlinks(id: string): EntrySummary[]
  /** Tüm korpus üzerinden sayımlar — sol raydaki sayaçlar bunu kullanır. */
  facets(): Facets
  size(): number
}

interface IndexDoc {
  id: string
  title: string
  body: string
  tags: string
  area: string
}

function emptyFacets(): Facets {
  return { types: {}, sources: {}, statuses: {}, severities: {}, tags: [], days: {} }
}

function bump(bucket: Record<string, number>, key: string | undefined): void {
  if (!key) return
  bucket[key] = (bucket[key] ?? 0) + 1
}

function computeFacets(entries: Entry[]): Facets {
  const facets = emptyFacets()
  const tagCounts = new Map<string, number>()
  for (const entry of entries) {
    bump(facets.types, entry.type)
    bump(facets.sources, entry.sourceId)
    bump(facets.statuses, entry.status)
    bump(facets.severities, entry.severity)
    bump(facets.days, localDayKey(entry.occurred_at))
    for (const tag of entry.tags ?? []) tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1)
  }
  facets.tags = [...tagCounts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, 'tr'))
  return facets
}

export class MiniSearchIndex implements SearchIndex {
  #entries = new Map<string, Entry>()
  #backlinkMap = new Map<string, Set<string>>()
  #mini = MiniSearchIndex.#createMini()

  static #createMini(): MiniSearch<IndexDoc> {
    return new MiniSearch<IndexDoc>({
      idField: 'id',
      fields: ['title', 'body', 'tags', 'area'],
      storeFields: [],
      // Hem indeksleme hem sorgu bu fonksiyondan geçer; "sokumu" → "söküm"
      // eşleşmesini sağlayan tek yer burası.
      processTerm: (term) => fold(term) || null,
      searchOptions: {
        prefix: true,
        fuzzy: 0.2,
        boost: { title: 3, tags: 2, area: 2 },
        combineWith: 'AND',
      },
    })
  }

  static #toDoc(entry: Entry): IndexDoc {
    return {
      id: entry.id,
      title: entry.title,
      body: entry.body,
      tags: (entry.tags ?? []).join(' '),
      area: entry.area ?? '',
    }
  }

  /**
   * Aynı `id` iki kaynakta varsa yazılabilir vault kazanır — ayna asla gerçek
   * kaydın üstüne binmez.
   */
  static #shouldReplace(existing: Entry | undefined, next: Entry): boolean {
    if (!existing) return true
    if (existing.path === next.path) return true
    return existing.readOnly && !next.readOnly
  }

  replaceAll(entries: Entry[]): void {
    this.#entries.clear()
    this.#backlinkMap.clear()
    this.#mini = MiniSearchIndex.#createMini()
    const docs: IndexDoc[] = []
    for (const entry of entries) {
      if (!MiniSearchIndex.#shouldReplace(this.#entries.get(entry.id), entry)) continue
      this.#entries.set(entry.id, entry)
    }
    for (const entry of this.#entries.values()) {
      docs.push(MiniSearchIndex.#toDoc(entry))
      this.#linkUp(entry)
    }
    this.#mini.addAll(docs)
  }

  upsert(entry: Entry): void {
    const existing = this.#entries.get(entry.id)
    if (!MiniSearchIndex.#shouldReplace(existing, entry)) return
    if (existing) {
      this.#mini.discard(existing.id)
      this.#linkDown(existing)
    }
    this.#entries.set(entry.id, entry)
    this.#mini.add(MiniSearchIndex.#toDoc(entry))
    this.#linkUp(entry)
  }

  remove(id: string): void {
    const existing = this.#entries.get(id)
    if (!existing) return
    this.#mini.discard(id)
    this.#linkDown(existing)
    this.#entries.delete(id)
  }

  #linkUp(entry: Entry): void {
    for (const target of entry.outboundLinks ?? []) {
      let set = this.#backlinkMap.get(target)
      if (!set) {
        set = new Set()
        this.#backlinkMap.set(target, set)
      }
      set.add(entry.id)
    }
  }

  #linkDown(entry: Entry): void {
    for (const target of entry.outboundLinks ?? []) {
      this.#backlinkMap.get(target)?.delete(entry.id)
    }
  }

  get(id: string): Entry | undefined {
    return this.#entries.get(id)
  }

  all(): Entry[] {
    return [...this.#entries.values()]
  }

  size(): number {
    return this.#entries.size
  }

  backlinks(id: string): EntrySummary[] {
    const sources = this.#backlinkMap.get(id)
    if (!sources) return []
    return [...sources]
      .map((sourceId) => this.#entries.get(sourceId))
      .filter((e): e is Entry => Boolean(e))
      .sort((a, b) => occurredAtMs(b.occurred_at) - occurredAtMs(a.occurred_at))
      .map(toSummary)
  }

  facets(): Facets {
    return computeFacets([...this.#entries.values()])
  }

  query(filter: QueryFilter, limit = 200, offset = 0): QueryResult {
    const text = filter.text?.trim()
    let ranking: Map<string, number> | undefined
    let candidates: Entry[]

    if (text) {
      // Varsayılan AND: çok kelimeli sorguda tek kelime tutmazsa sonuç BOŞ
      // döner ve çağıran (özellikle ajan) "kayıt yok" sonucuna varır. Boş
      // kümede OR'a düşüp alaka sırasına güveniyoruz — hiç sonuç yerine
      // en yakın sonuçlar.
      let hits = this.#mini.search(text)
      if (hits.length === 0) hits = this.#mini.search(text, { combineWith: 'OR' })
      ranking = new Map(hits.map((hit, i) => [String(hit.id), i]))
      candidates = hits
        .map((hit) => this.#entries.get(String(hit.id)))
        .filter((e): e is Entry => Boolean(e))
    } else {
      candidates = [...this.#entries.values()]
    }

    const matched = candidates.filter((entry) => matchesFilter(entry, filter))
    const sort = filter.sort ?? 'newest'
    matched.sort((a, b) => {
      if (sort === 'relevance' && ranking) {
        return (ranking.get(a.id) ?? 0) - (ranking.get(b.id) ?? 0)
      }
      const cmp = occurredAtMs(a.occurred_at) - occurredAtMs(b.occurred_at)
      return sort === 'oldest' ? cmp : -cmp
    })

    return {
      items: matched.slice(offset, offset + limit).map(toSummary),
      total: matched.length,
      facets: computeFacets(matched),
    }
  }
}

export function matchesFilter(entry: Entry, filter: QueryFilter): boolean {
  if (filter.types?.length && !filter.types.includes(entry.type)) return false
  if (filter.sources?.length && !filter.sources.includes(entry.sourceId)) return false
  if (filter.severities?.length && (!entry.severity || !filter.severities.includes(entry.severity))) {
    return false
  }
  if (filter.statuses?.length && (!entry.status || !filter.statuses.includes(entry.status))) {
    return false
  }
  if (filter.tags?.length) {
    const tags = entry.tags ?? []
    if (!filter.tags.every((tag) => tags.includes(tag))) return false
  }
  if (filter.stale && !trackingState(entry).stale) return false
  // Tarih karşılaştırması gün anahtarı üzerinden — saat dilimi kaymaları
  // "bugünü" listeden düşürmesin.
  const day = localDayKey(entry.occurred_at)
  if (filter.from && day < filter.from) return false
  if (filter.to && day > filter.to) return false
  return true
}
