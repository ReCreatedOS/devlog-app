import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  ACTIVE_STATUSES,
  STATUS_LABEL,
  compareTracked,
  configureStaleThresholds,
  trackingState,
} from '@devlog/core/shared'
import type {
  EntryStatus,
  EntrySummary,
  QueryFilter,
  SavedView,
  TrackingPatch,
} from '@devlog/core/shared'
import { PanelLeft, PanelRight, Plus, Settings } from 'lucide-react'
import { CalendarHeat } from './components/CalendarHeat'
import { Logo } from './components/Logo'
import { CaptureComposer } from './components/CaptureComposer'
import { DetailPane } from './components/DetailPane'
import { EntryList } from './components/EntryList'
import { FilterBar, type Density, type ListView } from './components/FilterBar'
import { SettingsPanel } from './components/SettingsPanel'
import { Sidebar } from './components/Sidebar'
import { TrackerView } from './components/TrackerView'
import { Button, EmptyState, IconButton, Kbd, SkeletonRows } from './components/primitives'
import { useEntryDetail, useLibrary } from './hooks/useLibrary'
import { useTheme } from './hooks/useTheme'
import type { AppSettings } from '../../shared/ipc.js'
import { cn } from './lib/cn'
import { dayHeading, daysAgoKey } from './lib/format'

/**
 * Rakam tuşlarına bağlı durumlar. Sekizin tamamı değil: `verified`/`done`
 * pratikte `fixed`'in eş anlamlısı gibi kullanılıyor ve sekiz kısayol ezberi
 * hızlandırmıyor, zorlaştırıyor. Menüde sekizi de var.
 */
const STATUS_KEYS: EntryStatus[] = ['open', 'in-progress', 'blocked', 'monitoring', 'fixed']

const SIDEBAR_RANGE = { min: 200, max: 320, initial: 240 }
const DETAIL_RANGE = { min: 360, max: 720, initial: 420 }
/** "Altta" yerleşiminde detay panelinin yüksekliği. */
const DETAIL_HEIGHT_RANGE = { min: 200, max: 620, initial: 320 }

/**
 * Pencere durumu `localStorage`'ta, KARARLAR `~/.devlog/config.json`'da.
 *
 * Ayrım şu soruyla yapılır: bunu CLI, MCP ya da hook'un bilmesi gerekir mi?
 * Panel genişliği hayır — kaybı yalnızca pencerenin varsayılan boyutta
 * açılmasıdır. Tema ve bayatlık eşiği evet.
 */
const UI_STATE_KEY = 'devlog.ui'

interface UiState {
  sidebarWidth?: number
  detailWidth?: number
  detailHeight?: number
  sidebarOpen?: boolean
  detailOpen?: boolean
  view?: ListView
  selectedId?: string | null
}

function readUiState(): UiState {
  try {
    return JSON.parse(localStorage.getItem(UI_STATE_KEY) ?? '{}') as UiState
  } catch {
    return {}
  }
}

function writeUiState(patch: UiState): void {
  try {
    localStorage.setItem(UI_STATE_KEY, JSON.stringify({ ...readUiState(), ...patch }))
  } catch {
    // Kota dolu ya da erişim yok — pencere durumu kaybı önemsiz, sessizce geç.
  }
}

/** Sürüklenebilir panel ayracı. */
function ResizeHandle({
  side,
  axis = 'horizontal',
  width,
  range,
  onResize,
}: {
  side: 'left' | 'right'
  /** Dikey eksen: "altta" yerleşiminde detay panelinin yüksekliği. */
  axis?: 'horizontal' | 'vertical'
  width: number
  range: { min: number; max: number }
  onResize: (next: number) => void
}): ReactNode {
  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    event.preventDefault()
    const vertical = axis === 'vertical'
    const start = vertical ? event.clientY : event.clientX
    const startWidth = width
    const move = (moveEvent: PointerEvent): void => {
      const current = vertical ? moveEvent.clientY : moveEvent.clientX
      const delta = vertical || side === 'right' ? start - current : current - start
      onResize(Math.min(range.max, Math.max(range.min, startWidth + delta)))
    }
    const up = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      document.body.style.cursor = ''
    }
    document.body.style.cursor = vertical ? 'row-resize' : 'col-resize'
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  return (
    <div
      onPointerDown={onPointerDown}
      className={cn(
        'relative z-20 shrink-0 bg-transparent transition-colors hover:bg-primary/40',
        axis === 'vertical' ? '-my-px h-0.5 cursor-row-resize' : '-mx-px w-0.5 cursor-col-resize',
      )}
    />
  )
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return (
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT' ||
    target.isContentEditable ||
    Boolean(target.closest('.cm-editor'))
  )
}

export function App(): ReactNode {
  const [filter, setFilter] = useState<QueryFilter>({ sort: 'newest' })
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [arrivedIds, setArrivedIds] = useState<ReadonlySet<string>>(() => new Set())
  const [editing, setEditing] = useState(false)
  const [density, setDensity] = useState<Density>('compact')
  const [view, setView] = useState<ListView>(() => readUiState().view ?? 'list')
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [composerOpen, setComposerOpen] = useState(false)
  const [toast, setToast] = useState<{ text: string; undo?: () => void } | null>(null)
  const [sidebarWidth, setSidebarWidth] = useState(
    () => readUiState().sidebarWidth ?? SIDEBAR_RANGE.initial,
  )
  const [detailWidth, setDetailWidth] = useState(
    () => readUiState().detailWidth ?? DETAIL_RANGE.initial,
  )
  const [detailHeight, setDetailHeight] = useState(
    () => readUiState().detailHeight ?? DETAIL_HEIGHT_RANGE.initial,
  )
  const [sidebarOpen, setSidebarOpen] = useState(() => readUiState().sidebarOpen ?? true)
  const [detailOpen, setDetailOpen] = useState(() => readUiState().detailOpen ?? true)

  const searchRef = useRef<HTMLInputElement | null>(null)
  const { result, facets, status, loading, refresh } = useLibrary(filter)
  useTheme(settings?.theme, settings?.accent, settings?.font)
  const { detail } = useEntryDetail(selectedId)

  const items = useMemo(() => result?.items ?? [], [result])

  /**
   * Klavye gezinmesi EKRANDA GÖRÜNEN sırayı izlemeli. Takip kipi kayıtları
   * aciliyete göre diziyor; j/k hâlâ tarih sırasında yürüseydi seçim listede
   * zıplardı.
   */
  const visibleItems = useMemo<EntrySummary[]>(() => {
    if (view !== 'tracker') return items
    const now = new Date()
    return items
      .filter((item) => item.status && ACTIVE_STATUSES.includes(item.status))
      .sort((a, b) => {
        const rank =
          ACTIVE_STATUSES.indexOf(a.status ?? 'open') - ACTIVE_STATUSES.indexOf(b.status ?? 'open')
        return rank !== 0 ? rank : compareTracked(a, b, now)
      })
  }, [items, view])

  // Seçili kayıt filtreden düşerse listenin başına dön — boş detay paneline
  // bakmaktansa bir sonraki kaydı göstermek daha yararlı.
  useEffect(() => {
    if (visibleItems.length === 0) {
      setSelectedId(null)
      return
    }
    if (!selectedId || !visibleItems.some((item) => item.id === selectedId)) {
      setSelectedId(visibleItems[0]?.id ?? null)
    }
  }, [visibleItems, selectedId])

  // Takım arkadaşından gelen kayıtlar birkaç saniye işaretli kalır: liste
  // sessizce kaydığında neyin yeni olduğunu gözle bulmak imkânsız.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const off = window.devlog.onArrived((ids) => {
      setArrivedIds(new Set(ids))
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => setArrivedIds(new Set()), 4_000)
    })
    return () => {
      off()
      if (timer) clearTimeout(timer)
    }
  }, [])

  // Ayarlar: tema, bayatlık eşikleri ve açılış kipi buradan gelir.
  useEffect(() => {
    void window.devlog.settings().then((next) => {
      setSettings(next)
      setDensity(next.density)
      configureStaleThresholds(next.staleAfterDays)
      const saved = readUiState()
      setView(next.startup === 'resume' ? (saved.view ?? 'list') : next.startup)
      if (next.startup === 'resume' && saved.selectedId) setSelectedId(saved.selectedId)
    })
  }, [])

  useEffect(() => {
    writeUiState({
      sidebarWidth,
      detailWidth,
      detailHeight,
      sidebarOpen,
      detailOpen,
      view,
      selectedId,
    })
  }, [sidebarWidth, detailWidth, detailHeight, sidebarOpen, detailOpen, view, selectedId])

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), 2600)
    return () => clearTimeout(timer)
  }, [toast])

  const openEntry = useCallback((id: string) => {
    setSelectedId(id)
    setEditing(false)
  }, [])

  const move = useCallback(
    (delta: number) => {
      if (visibleItems.length === 0) return
      const index = visibleItems.findIndex((item) => item.id === selectedId)
      const next = Math.min(visibleItems.length - 1, Math.max(0, (index < 0 ? 0 : index) + delta))
      setSelectedId(visibleItems[next]?.id ?? null)
    },
    [visibleItems, selectedId],
  )

  /**
   * Takip alanlarını değiştirmenin tek yolu. Geri alma şart: durum değiştirmek
   * artık tek tuş, yanlış tuşa basmak da öyle.
   */
  const track = useCallback(
    async (id: string, patch: TrackingPatch, previous?: TrackingPatch): Promise<void> => {
      const entry = await window.devlog.track(id, patch)
      if (!entry) {
        setToast({ text: 'Kayıt bulunamadı' })
        return
      }
      const label =
        patch.status !== undefined
          ? `Durum: ${patch.status ? STATUS_LABEL[patch.status] : 'kaldırıldı'}`
          : 'Takip güncellendi'
      setToast({
        text: label,
        undo: previous ? () => void window.devlog.track(id, previous) : undefined,
      })
    },
    [],
  )

  const updateSettings = useCallback(async (patch: Partial<AppSettings>): Promise<void> => {
    const next = await window.devlog.updateSettings(patch)
    setSettings(next)
    setDensity(next.density)
    configureStaleThresholds(next.staleAfterDays)
  }, [])

  const removeEntry = useCallback(async (id: string): Promise<void> => {
    await window.devlog.remove(id)
    setToast({ text: 'Kayıt silindi' })
  }, [])

  const setStatus = useCallback(
    (id: string, next: EntryStatus | null) => {
      const current = visibleItems.find((item) => item.id === id)
      if (current?.status === next) return
      void track(id, { status: next }, { status: current?.status ?? null })
    },
    [track, visibleItems],
  )

  useEffect(() => {
    const offFocus = window.devlog.onFocusEntry((id) => openEntry(id))
    const offNew = window.devlog.onNewEntry(() => setComposerOpen(true))
    return () => {
      offFocus()
      offNew()
    }
  }, [openEntry])

  useEffect(() => {
    let lastKey = ''
    let lastKeyAt = 0

    const onKeyDown = (event: KeyboardEvent): void => {
      const mod = event.metaKey || event.ctrlKey

      if (mod && event.key === 'e') {
        event.preventDefault()
        if (detail?.entry && !detail.entry.readOnly) setEditing(true)
        return
      }
      if (mod && event.key === ',') {
        event.preventDefault()
        setSettingsOpen((v) => !v)
        return
      }
      if (mod && event.key === '\\') {
        event.preventDefault()
        setSidebarOpen((v) => !v)
        return
      }
      if (mod && event.key === '/') {
        event.preventDefault()
        setDetailOpen((v) => !v)
        return
      }

      if (isTypingTarget(event.target)) return

      if (event.key === '/') {
        event.preventDefault()
        searchRef.current?.focus()
        return
      }
      // 1–5: seçili kaydın durumunu değiştir. Uygulamanın en sık eylemi bu.
      const digit = Number(event.key)
      if (Number.isInteger(digit) && digit >= 1 && digit <= STATUS_KEYS.length && selectedId) {
        const next = STATUS_KEYS[digit - 1]
        if (next) {
          event.preventDefault()
          setStatus(selectedId, next)
          return
        }
      }
      if (event.key === 'j' || event.key === 'ArrowDown') {
        event.preventDefault()
        move(1)
        return
      }
      if (event.key === 'k' || event.key === 'ArrowUp') {
        event.preventDefault()
        move(-1)
        return
      }
      if (event.key === 'Escape') {
        if (composerOpen) setComposerOpen(false)
        else if (editing) setEditing(false)
        else setFilter({ sort: filter.sort })
        return
      }
      // `g d` → bugüne git
      if (event.key === 'd' && lastKey === 'g' && Date.now() - lastKeyAt < 700) {
        event.preventDefault()
        const today = new Date().toISOString().slice(0, 10)
        setFilter((prev) => ({ ...prev, from: today, to: undefined }))
      }
      lastKey = event.key
      lastKeyAt = Date.now()
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [composerOpen, detail, editing, filter.sort, move, selectedId, setStatus])

  const handleCreate = async (text: string, openAfter: boolean): Promise<void> => {
    const outcome = await window.devlog.capture.submit(text)
    if (!outcome.ok) {
      setToast({ text: outcome.message })
      return
    }
    setComposerOpen(false)
    setToast({ text: 'Kayıt oluşturuldu' })
    await refresh()
    if (openAfter) openEntry(outcome.id)
    else setSelectedId(outcome.id)
  }

  /** Kayıtlı görünüm hem filtreyi hem kipi kurar — soru ve okuma biçimi birlikte gelir. */
  const applySavedView = useCallback((view: SavedView): void => {
    setFilter((prev) => ({
      sort: prev.sort,
      types: view.filter.types,
      statuses: view.filter.statuses,
      severities: view.filter.severities,
      stale: view.filter.stale,
      from: view.filter.days ? daysAgoKey(view.filter.days) : undefined,
    }))
    setView(view.view ?? 'list')
  }, [])

  const vaultName = status?.vaultRoot.split('/').filter(Boolean).at(-1) ?? 'devlog'
  const layout = settings?.layout ?? 'sag'

  const detailPane = (
    <DetailPane
      detail={detail}
      editing={editing}
      onEdit={() => setEditing(true)}
      onCancelEdit={() => setEditing(false)}
      onOpenEntry={openEntry}
      onTagClick={(tag) => setFilter((prev) => ({ ...prev, tags: [tag] }))}
      onTrack={(id, patch) => void track(id, patch)}
      onDelete={(id) => {
        void removeEntry(id)
        setEditing(false)
      }}
      onSaved={() => {
        setEditing(false)
        setToast({ text: 'Kaydedildi' })
      }}
    />
  )

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      {/* Başlık çubuğu: macOS'ta trafik ışıkları için sol boşluk, her yerde sürükleme alanı. */}
      <header
        className={cn(
          'surface-header drag-region flex h-11 shrink-0 items-center gap-2.5 border-b border-border px-3',
          window.devlog.platform === 'darwin' && 'pl-20',
        )}
      >
        <Logo size={15} />
        <span className="text-[13px] font-semibold tracking-[-0.01em]">devlog</span>
        <span className="truncate text-[12px] text-ink-3">{vaultName}</span>

        <div className="ml-auto flex items-center gap-1">
          <Button variant="outline" onClick={() => setComposerOpen(true)} className="no-drag">
            <Plus size={13} strokeWidth={1.75} />
            Yeni kayıt
            <Kbd>⌘N</Kbd>
          </Button>
          <IconButton
            onClick={() => setSettingsOpen(true)}
            title="Ayarlar (⌘,)"
          >
            <Settings size={14} strokeWidth={1.5} />
          </IconButton>
          <IconButton
            onClick={() => setSidebarOpen((v) => !v)}
            active={sidebarOpen}
            title="Sol paneli aç/kapat (⌘\)"
          >
            <PanelLeft size={14} strokeWidth={1.5} />
          </IconButton>
          <IconButton
            onClick={() => setDetailOpen((v) => !v)}
            active={detailOpen}
            title="Detay panelini aç/kapat (⌘/)"
          >
            <PanelRight size={14} strokeWidth={1.5} />
          </IconButton>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {sidebarOpen ? (
          <>
            <div style={{ width: sidebarWidth }} className="shrink-0">
              <Sidebar
                filter={filter}
                facets={facets}
                status={status}
                onFilterChange={setFilter}
                onSavedView={applySavedView}
                onReindex={() => void window.devlog.reindex()}
              />
            </div>
            <ResizeHandle
              side="left"
              width={sidebarWidth}
              range={SIDEBAR_RANGE}
              onResize={setSidebarWidth}
            />
          </>
        ) : null}

        <main className="flex min-w-0 flex-1 flex-col border-r border-border bg-card">
          <FilterBar
            filter={filter}
            facets={facets}
            total={result?.total ?? 0}
            density={density}
            view={view}
            searchRef={searchRef}
            onFilterChange={setFilter}
            onDensityChange={(next) => void updateSettings({ density: next })}
            onViewChange={setView}
          />

          {loading ? (
            <SkeletonRows />
          ) : view === 'tracker' ? (
            <TrackerView
              items={visibleItems}
              selectedId={selectedId}
              onSelect={openEntry}
              onStatusChange={setStatus}
              onPinToggle={(id, pinned) => void track(id, { pinned })}
              onDelete={removeEntry}
            />
          ) : view === 'calendar' ? (
            <CalendarHeat
              days={facets.days}
              selectedDay={filter.from === filter.to ? filter.from : undefined}
              onSelectDay={(day) => {
                setFilter((prev) => ({ ...prev, from: day, to: day }))
                setView('list')
              }}
            />
          ) : items.length === 0 ? (
            <EmptyState
              title={
                status && status.count === 0 ? 'Henüz kayıt yok' : 'Bu filtreye uyan kayıt yok'
              }
              hint={
                status && status.count === 0 ? (
                  <span className="inline-flex flex-wrap items-center justify-center gap-1">
                    <Kbd>⌘N</Kbd> ile ilk kaydını oluştur, ya da global kısayolla
                    (<Kbd>⌥Space</Kbd>) ne yapıyorsan bırakmadan yaz.
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1">
                    <Kbd>Esc</Kbd> filtreleri temizler.
                  </span>
                )
              }
            />
          ) : (
            <EntryList
              items={items}
              selectedId={selectedId}
              density={density}
              onSelect={openEntry}
              onStatusChange={setStatus}
              onPinToggle={(id, pinned) => void track(id, { pinned })}
              onDelete={removeEntry}
              arrivedIds={arrivedIds}
              onTagClick={(tag) =>
                setFilter((prev) => ({
                  ...prev,
                  tags: prev.tags?.includes(tag)
                    ? prev.tags.filter((t) => t !== tag)
                    : [...(prev.tags ?? []), tag],
                }))
              }
            />
          )}

          {detailOpen && layout === 'alt' ? (
            <>
              <ResizeHandle
                side="right"
                axis="vertical"
                width={detailHeight}
                range={DETAIL_HEIGHT_RANGE}
                onResize={setDetailHeight}
              />
              <aside
                style={{ height: detailHeight }}
                className="shrink-0 border-t border-border bg-background"
              >
                {detailPane}
              </aside>
            </>
          ) : null}

          {filter.from && filter.from === filter.to ? (
            <div className="flex h-8 shrink-0 items-center gap-2 border-t border-border px-3 text-[11px] text-muted-foreground">
              <span>{dayHeading(filter.from)} filtreleniyor</span>
              <button
                type="button"
                onClick={() => setFilter((prev) => ({ ...prev, from: undefined, to: undefined }))}
                className="text-primary hover:underline"
              >
                temizle
              </button>
            </div>
          ) : null}
        </main>

        {detailOpen && layout === 'sag' ? (
          <>
            <ResizeHandle
              side="right"
              width={detailWidth}
              range={DETAIL_RANGE}
              onResize={setDetailWidth}
            />
            <aside style={{ width: detailWidth }} className="shrink-0 bg-background">
              {detailPane}
            </aside>
          </>
        ) : null}
      </div>

      {settingsOpen && settings ? (
        <SettingsPanel
          settings={settings}
          staleCount={items.filter((item) => trackingState(item).stale).length}
          onChange={(patch) => void updateSettings(patch)}
          onClose={() => setSettingsOpen(false)}
          onReindex={() => void window.devlog.reindex()}
          onReplace={setSettings}
        />
      ) : null}

      {composerOpen ? (
        <div
          className="absolute inset-0 z-50 flex justify-center bg-black/40 pt-[12vh]"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setComposerOpen(false)
          }}
        >
          <div className="w-[640px] max-w-[90vw]">
            <CaptureComposer
              onSubmit={handleCreate}
              onClose={() => setComposerOpen(false)}
              placeholder="Ne oldu? İlk satır başlık olur…"
            />
          </div>
        </div>
      ) : null}

      {toast ? (
        <div className="absolute bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-md border border-border bg-popover px-3 py-1.5 text-[12px] shadow-[var(--shadow-panel)]">
          <span>{toast.text}</span>
          {toast.undo ? (
            <button
              type="button"
              onClick={() => {
                toast.undo?.()
                setToast(null)
              }}
              className="text-primary hover:underline"
            >
              geri al
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
