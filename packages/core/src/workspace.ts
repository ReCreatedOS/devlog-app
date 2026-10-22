import path from 'node:path'
import { loadConfig, vaultSource, type DevlogConfig } from './config.js'
import { MiniSearchIndex } from './search.js'
import { loadClaudeMemorySource } from './sources/claude-memory.js'
import { applyTracking, loadTracking, matchTracking, type TrackingRecord } from './tracking-store.js'
import { configureStaleThresholds } from './tracking.js'
import type { Entry, SourceInfo } from './types.js'
import { listMarkdownFiles, readEntryFile, type ReadFailure } from './vault.js'

/**
 * Kaynakları okuyup indeksi kuran ortak yol.
 *
 * Masaüstü uygulaması buna dosya izleyici ekler; CLI ve MCP sunucusu tek
 * seferlik okuma için doğrudan kullanır. Üç aracın da aynı kodu çalıştırması,
 * "CLI'da görünüyor ama uygulamada yok" sınıfı tutarsızlıkları imkânsız kılar.
 */

export function allSources(config: DevlogConfig): SourceInfo[] {
  // Kapalı kaynaklar taranmaz; vault her zaman açıktır.
  return [vaultSource(config.vaultRoot), ...config.sources.filter((s) => s.enabled !== false)]
}

/** Kapalılar dâhil tüm kaynaklar — ayarlar ekranı bunu gösterir. */
export function configuredSources(config: DevlogConfig): SourceInfo[] {
  return [vaultSource(config.vaultRoot), ...config.sources]
}

/**
 * Aynı id'yi iki ayrı dosyada gören kayıtlar.
 *
 * İndeks çakışmada birini sessizce düşürüyor (yazılabilir vault kazanır). Bu
 * sessizlik tehlikeli: kaybeden kayıt hiç görünmez ve ona ait bir takip dosyası
 * varsa hangi kayda bindiği belirsizleşir. Kurtarma değil, görünürlük —
 * kullanıcı tek satır uyarı görsün.
 */
export function findCollisions(entries: Entry[]): string[] {
  const paths = new Map<string, Set<string>>()
  for (const entry of entries) {
    let set = paths.get(entry.id)
    if (!set) {
      set = new Set()
      paths.set(entry.id, set)
    }
    set.add(entry.path)
  }
  return [...paths.entries()].filter(([, set]) => set.size > 1).map(([id]) => id)
}

export async function loadSourceEntries(
  source: SourceInfo,
  failures: ReadFailure[] = [],
): Promise<Entry[]> {
  if (source.dialect === 'claude-memory') return loadClaudeMemorySource(source)

  const files = await listMarkdownFiles(path.join(source.root, 'entries'))
  const entries: Entry[] = []
  for (const file of files) {
    const outcome = await readEntryFile(file, {
      sourceId: source.id,
      readOnly: source.readOnly,
    }).catch(() => null)
    if (!outcome) continue
    if (outcome.ok) entries.push(outcome.entry)
    else failures.push(outcome.failure)
  }
  return entries
}

export interface LoadedWorkspace {
  config: DevlogConfig
  entries: Entry[]
  failures: ReadFailure[]
  /** `id → takip kaydı`. Hiçbir kayda denk düşmeyenler `orphanTracking`'te. */
  tracking: Map<string, TrackingRecord>
  /** Hedefi kaybolmuş takip dosyaları — asla otomatik silinmez, yalnız bildirilir. */
  orphanTracking: string[]
  /** Aynı id'yi iki kaynakta gören kayıtlar — biri sessizce düşürüldü. */
  collisions: string[]
}

export async function loadWorkspace(config?: DevlogConfig): Promise<LoadedWorkspace> {
  const resolved = config ?? (await loadConfig())
  configureStaleThresholds(resolved.tracking?.staleAfterDays)
  const failures: ReadFailure[] = []
  const loaded: Entry[] = []
  for (const source of allSources(resolved)) {
    loaded.push(...(await loadSourceEntries(source, failures)))
  }

  // Takip katmanı en son biner: kaynak ne derse desin, kullanıcının verdiği
  // karar üsttedir.
  const tracking = await loadTracking(resolved.vaultRoot)
  const { byEntry, orphans } = matchTracking(loaded, tracking)
  const entries = loaded.map((entry) => applyTracking(entry, byEntry.get(entry.id)))

  return {
    config: resolved,
    entries,
    failures,
    tracking: byEntry,
    orphanTracking: orphans.map((record) => record.tracks),
    collisions: findCollisions(entries),
  }
}

export interface OpenedIndex extends LoadedWorkspace {
  index: MiniSearchIndex
}

export async function openIndex(config?: DevlogConfig): Promise<OpenedIndex> {
  const workspace = await loadWorkspace(config)
  const index = new MiniSearchIndex()
  index.replaceAll(workspace.entries)
  return { ...workspace, index }
}
