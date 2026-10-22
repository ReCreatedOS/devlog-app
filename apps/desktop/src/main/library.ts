import { EventEmitter } from 'node:events'
import path from 'node:path'
import chokidar, { type FSWatcher } from 'chokidar'
import {
  MiniSearchIndex,
  allSources,
  applyTracking,
  createEntry,
  deleteEntryFile,
  ACTIVE_STATUSES,
  STALE_AFTER_DAYS,
  configuredSources,
  configureStaleThresholds,
  ensureVault,
  entryRelativePath,
  findCollisions,
  loadSourceEntries,
  loadTracking,
  localIso,
  matchTracking,
  readClaudeMemoryFile,
  readEntryFile,
  readTracking,
  redact,
  trackEntry,
  trackingDir,
  writeEntry,
} from '@devlog/core'
import type {
  Entry,
  EntryDraft,
  EntryFrontmatter,
  Facets,
  QueryFilter,
  QueryResult,
  ReadFailure,
  SourceInfo,
  TrackingPatch,
  TrackingRecord,
} from '@devlog/core'
import type { AppConfig } from './config.js'
import type { EntryDetail, LibraryStatus, SaveOutcome } from '../shared/ipc.js'

/**
 * Ana süreçteki veri katmanı: kaynakları tarar, indeksi kurar, dosya
 * değişikliklerini izler. Renderer buraya yalnız IPC üzerinden konuşur.
 *
 * İndeks tamamen türetilmiştir — süreç çökse, indeks bozulsa bile tek yapılan
 * `reindex()` çağırmaktır; hiçbir veri kaybolmaz çünkü kaynak daima markdown.
 */
export class Library extends EventEmitter {
  #config: AppConfig
  #index = new MiniSearchIndex()
  #pathToId = new Map<string, string>()
  #tracking = new Map<string, TrackingRecord>()
  #orphans: string[] = []
  #collisions: string[] = []
  #failures: ReadFailure[] = []
  #watcher: FSWatcher | null = null
  #indexing = false
  #pending = new Map<string, NodeJS.Timeout>()

  constructor(config: AppConfig) {
    super()
    this.#config = config
  }

  get sources(): SourceInfo[] {
    return allSources(this.#config)
  }

  get config(): AppConfig {
    return this.#config
  }

  /**
   * Ayarlar değişti: eşikleri yeniden kur, kaynak kümesi değiştiyse izleyiciyi
   * ve indeksi baştan kur. Kaynak değişmediyse yeniden tarama yapmıyoruz —
   * tema değiştirmek 74 dosyayı yeniden okumamalı.
   */
  async applyConfig(next: AppConfig): Promise<void> {
    const before = JSON.stringify([this.#config.vaultRoot, this.#config.sources])
    this.#config = next
    configureStaleThresholds(next.tracking?.staleAfterDays)
    const after = JSON.stringify([next.vaultRoot, next.sources])
    if (before !== after) {
      await this.#watcher?.close()
      this.#watcher = null
      await this.reindex()
      this.#startWatching()
    } else {
      this.emit('status')
    }
  }

  get vaultRoot(): string {
    return this.#config.vaultRoot
  }

  async init(): Promise<void> {
    await ensureVault(this.#config.vaultRoot)
    await this.reindex()
    this.#startWatching()
  }

  async reindex(): Promise<void> {
    this.#indexing = true
    this.emit('status')
    const loaded: Entry[] = []
    const failures: ReadFailure[] = []
    this.#pathToId.clear()

    for (const source of this.sources) {
      loaded.push(...(await this.#loadSource(source, failures)))
    }

    // Takip katmanı en son biner: kaynak ne derse desin, verilmiş karar üsttedir.
    const stored = await loadTracking(this.#config.vaultRoot)
    const { byEntry, orphans } = matchTracking(loaded, stored)
    this.#tracking = byEntry
    this.#orphans = orphans.map((record) => record.tracks)
    this.#collisions = findCollisions(loaded)
    const entries = loaded.map((entry) => applyTracking(entry, byEntry.get(entry.id)))

    this.#index.replaceAll(entries)
    for (const entry of entries) this.#pathToId.set(entry.path, entry.id)
    this.#failures = failures
    this.#indexing = false
    this.emit('status')
    this.emit('changed')
  }

  async #loadSource(source: SourceInfo, failures: ReadFailure[]): Promise<Entry[]> {
    return loadSourceEntries(source, failures)
  }

  #sourceForPath(absPath: string): SourceInfo | undefined {
    // En uzun eşleşen kök kazanır. Karşılaştırma HESAPLANAN kök üzerinden
    // yapılmalı (vault'ta bu `<root>/entries`); ham `source.root` ile kıyaslamak
    // iç içe kaynaklarda yanlış kaynağa yönlendirir ve salt-okunur bir dosya
    // yazılabilir sanılabilirdi.
    let best: { source: SourceInfo; root: string } | undefined
    for (const source of this.sources) {
      const root = source.dialect === 'devlog' ? path.join(source.root, 'entries') : source.root
      if (!absPath.startsWith(`${root}${path.sep}`)) continue
      if (!best || root.length > best.root.length) best = { source, root }
    }
    return best?.source
  }

  #startWatching(): void {
    const roots = this.sources.map((s) =>
      s.dialect === 'devlog' ? path.join(s.root, 'entries') : s.root,
    )
    // Takip dizini de izlenir: durumu CLI'dan ya da ajandan değiştirdiğinde
    // uygulama yeniden başlatılmadan görsün.
    roots.push(trackingDir(this.#config.vaultRoot))
    this.#watcher = chokidar.watch(roots, {
      ignoreInitial: true,
      // Atomik yazma (write + rename) sırasında yarım dosya okumayalım.
      awaitWriteFinish: { stabilityThreshold: 120, pollInterval: 30 },
      ignored: (target) => path.basename(target).startsWith('.'),
    })
    this.#watcher
      .on('add', (file) => this.#schedule(file))
      .on('change', (file) => this.#schedule(file))
      .on('unlink', (file) => this.#handleUnlink(file))
  }

  /** Aynı dosyaya arka arkaya gelen olayları tek okumaya indirger. */
  #schedule(file: string): void {
    if (!file.endsWith('.md')) return
    if (this.#isTrackingPath(file)) {
      void this.#reloadTracking(file)
      return
    }
    const existing = this.#pending.get(file)
    if (existing) clearTimeout(existing)
    this.#pending.set(
      file,
      setTimeout(() => {
        this.#pending.delete(file)
        void this.#reload(file)
      }, 150),
    )
  }

  #isTrackingPath(file: string): boolean {
    return file.startsWith(`${trackingDir(this.#config.vaultRoot)}${path.sep}`)
  }

  /**
   * Takip dosyası değişti: kaydı KAYNAĞINDAN yeniden okuyup katmanı yeniden
   * bindiriyoruz. Bindirilmiş kaydın üstüne tekrar bindirmek `derived`
   * işaretlerini kalıcı olarak eritirdi.
   */
  async #reloadTracking(file: string): Promise<void> {
    // Dosya adı kimlik DEĞİL (id'nin güvenli türevi), bu yüzden hangi kaydı
    // etkilediğini dosyadan okuyup buluyoruz.
    const record = await readTracking(file)
    const stored = await loadTracking(this.#config.vaultRoot)
    const entries = this.#index.all()
    const { byEntry, orphans } = matchTracking(entries, stored)
    this.#tracking = byEntry
    this.#orphans = orphans.map((r) => r.tracks)

    const touched = record?.tracks
    const target = touched ? this.#index.get(touched) : undefined
    if (target) await this.#reload(target.path)
    else {
      // Silinen ya da öksüz bir takip dosyası: hangi kaydın etkilendiğini
      // bilmiyoruz, güvenli yol tam tazeleme.
      for (const entry of entries) {
        if (!this.#tracking.has(entry.id) && entry.overridden) await this.#reload(entry.path)
      }
    }
    this.emit('status')
  }

  async #reload(file: string): Promise<void> {
    const source = this.#sourceForPath(file)
    if (!source) return
    if (path.basename(file) === 'MEMORY.md') return

    if (source.dialect === 'claude-memory') {
      const base = await readClaudeMemoryFile(file, source)
      if (!base) return
      const entry = applyTracking(base, this.#tracking.get(base.id))
      this.#index.upsert(entry)
      this.#pathToId.set(file, entry.id)
      this.emit('changed', entry.id)
      return
    }

    const outcome = await readEntryFile(file, {
      sourceId: source.id,
      readOnly: source.readOnly,
    }).catch(() => null)
    if (!outcome) return
    if (!outcome.ok) {
      this.#failures = [...this.#failures.filter((f) => f.path !== file), outcome.failure]
      this.emit('status')
      return
    }
    this.#failures = this.#failures.filter((f) => f.path !== file)
    const entry = applyTracking(outcome.entry, this.#tracking.get(outcome.entry.id))
    this.#index.upsert(entry)
    this.#pathToId.set(file, entry.id)
    this.emit('changed', entry.id)
  }

  #handleUnlink(file: string): void {
    if (this.#isTrackingPath(file)) {
      // Takip dosyası silindi: kaydın durumu kaynağın söylediğine geri dönmeli,
      // ekranda asılı kalmamalı.
      void this.#reloadTracking(file)
      return
    }
    const id = this.#pathToId.get(file)
    if (!id) return
    this.#index.remove(id)
    this.#pathToId.delete(file)
    this.#failures = this.#failures.filter((f) => f.path !== file)
    this.emit('changed')
  }

  query(filter: QueryFilter, limit?: number, offset?: number): QueryResult {
    return this.#index.query(filter, limit, offset)
  }

  facets(): Facets {
    return this.#index.facets()
  }

  detail(id: string): EntryDetail | null {
    const entry = this.#index.get(id)
    if (!entry) return null
    return { entry, backlinks: this.#index.backlinks(id) }
  }

  /** `[[link]]` hedeflerinin karşılığı var mı — tek turda çözülür. */
  resolve(ids: string[]): Record<string, boolean> {
    const out: Record<string, boolean> = {}
    for (const id of ids) out[id] = this.#index.get(id) !== undefined
    return out
  }

  status(): LibraryStatus {
    const facets = this.#index.facets()
    return {
      indexing: this.#indexing,
      count: this.#index.size(),
      vaultRoot: this.#config.vaultRoot,
      // Kapalı kaynaklar da listelenir: ayarlar ekranı onları geri açabilsin.
      sources: configuredSources(this.#config).map((s) => ({
        ...s,
        count: facets.sources[s.id] ?? 0,
      })),
      staleAfterDays: Object.fromEntries(
        ACTIVE_STATUSES.map((status) => [status, STALE_AFTER_DAYS[status]]),
      ),
      failures: this.#failures,
      tracked: this.#tracking.size,
      orphanTracking: this.#orphans,
      collisions: this.#collisions,
    }
  }

  async create(draft: EntryDraft): Promise<Entry> {
    const entry = await createEntry(this.#config.vaultRoot, draft)
    this.#index.upsert(entry)
    this.#pathToId.set(entry.path, entry.id)
    this.emit('changed', entry.id)
    return entry
  }

  /**
   * `baseUpdatedAt` çakışma korumasıdır: kullanıcı düzenlerken ajan aynı dosyaya
   * yazdıysa üstüne binmek yerine `conflict` döneriz ve UI şeridi çıkar.
   */
  async save(
    id: string,
    frontmatter: EntryFrontmatter,
    body: string,
    baseUpdatedAt?: string,
  ): Promise<SaveOutcome> {
    const current = this.#index.get(id)
    if (!current) return { ok: false, reason: 'missing', message: 'Kayıt bulunamadı.' }
    if (current.readOnly) {
      return { ok: false, reason: 'readonly', message: 'Bu kayıt salt-okunur bir aynadan geliyor.' }
    }
    if (baseUpdatedAt && current.updated_at && current.updated_at !== baseUpdatedAt) {
      return { ok: false, reason: 'conflict', current }
    }

    const next: EntryFrontmatter = {
      ...frontmatter,
      id,
      created_at: current.created_at,
      updated_at: localIso(),
    }
    let absPath: string
    try {
      absPath = await writeEntry(this.#config.vaultRoot, next, body, current.path)
    } catch (error) {
      return { ok: false, reason: 'invalid', message: error instanceof Error ? error.message : String(error) }
    }
    const entry: Entry = {
      ...next,
      body,
      path: absPath,
      sourceId: 'vault',
      readOnly: false,
      outboundLinks: current.outboundLinks,
    }
    this.#index.upsert(entry)
    this.#pathToId.set(absPath, id)
    this.emit('changed', id)
    return { ok: true, entry }
  }

  /**
   * Takip alanlarını (durum, severity, sıradaki adım, gözden geçirme, sabitleme)
   * değiştiren TEK yol.
   *
   * Yönlendirme kaydın yazılabilirliğine göre yapılır ve çağıranın bunu bilmesi
   * gerekmez:
   * - yazılabilir kayıt → kendi frontmatter'ına yazılır (tek gerçek orada kalır),
   * - salt-okunur ayna  → vault'taki `tracking/<id>.md` dosyasına yazılır,
   *   kaynağa tek bayt dokunulmaz.
   */
  async setTracking(
    id: string,
    patch: TrackingPatch,
    by: 'user' | 'agent' = 'user',
  ): Promise<Entry | null> {
    const current = this.#index.get(id)
    if (!current) return null

    const outcome = await trackEntry(this.#config.vaultRoot, current, safePatch(patch), by)

    if (outcome.target === 'entry' && outcome.frontmatter) {
      this.#tracking.delete(id)
      const entry: Entry = { ...current, ...outcome.frontmatter, path: outcome.path }
      this.#index.upsert(entry)
      this.#pathToId.set(outcome.path, id)
      this.emit('changed', id)
      return entry
    }

    if (outcome.record) this.#tracking.set(id, outcome.record)
    await this.#reload(current.path)
    return this.#index.get(id) ?? null
  }

  async remove(id: string): Promise<boolean> {
    const entry = this.#index.get(id)
    if (!entry || entry.readOnly) return false
    await deleteEntryFile(entry.path)
    this.#index.remove(id)
    this.#pathToId.delete(entry.path)
    this.emit('changed')
    return true
  }

  /** Bir kaydın diskteki yolu — "Finder'da göster" için. */
  pathFor(id: string): string | null {
    const entry = this.#index.get(id)
    if (entry) return entry.path
    return path.join(this.#config.vaultRoot, entryRelativePath(id))
  }

  async dispose(): Promise<void> {
    for (const timer of this.#pending.values()) clearTimeout(timer)
    this.#pending.clear()
    await this.#watcher?.close()
    this.#watcher = null
  }
}

/**
 * Takip metinleri de git deposuna giriyor — gövdelerde uygulanan sır maskesi
 * burada da uygulanır. Serbest metin kısa olduğu için reddetmek yerine
 * maskeliyoruz: bir durum notunu yazarken kapıya takılmak akışı bozar.
 */
function safePatch(patch: TrackingPatch): TrackingPatch {
  const mask = (value: string | null | undefined): string | null | undefined =>
    typeof value === 'string' ? redact(value).text : value
  return { ...patch, next_action: mask(patch.next_action), note: mask(patch.note) }
}
