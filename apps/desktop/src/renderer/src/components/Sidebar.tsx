import type { ReactNode } from 'react'
import { ENTRY_TYPES, SAVED_VIEWS, TYPE_META } from '@devlog/core/shared'
import type { EntryType, Facets, QueryFilter, SavedView } from '@devlog/core/shared'
import { AlertTriangle, Copy, Hash, Layers, Loader2, RefreshCw, Star, Unlink } from 'lucide-react'
import { cn } from '../lib/cn'
/**
 * Kayıtlı görünümün sayacı. Bayatlık sayısı korpus taraması gerektirdiği için
 * burada hesaplanmaz — o rakam takip kipinin kendi şeridinde çıkar.
 */
function countForView(view: SavedView, facets: Facets): number | undefined {
  const statuses = view.filter.statuses
  if (!statuses?.length) return undefined
  return statuses.reduce((total, status) => total + (facets.statuses[status] ?? 0), 0)
}
import type { LibraryStatus } from '../../../shared/ipc.js'
import { SectionLabel } from './primitives'

interface RailItemProps {
  label: string
  count?: number
  active?: boolean
  icon?: ReactNode
  onClick: () => void
}

function RailItem({ label, count, active, icon, onClick }: RailItemProps): ReactNode {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'hit group relative flex h-7 w-full items-center gap-2 rounded-sm px-2 text-[13px]',
        active ? 'bg-tint-2 font-medium text-ink' : 'text-ink-2 hover:bg-tint-1 hover:text-ink',
      )}
    >
      {/* Aktif satırın sol kenarında ince vurgu — "buradasın" işareti dolgunun
          kendisinden daha sessiz ve daha kesin. */}
      {active ? (
        <span
          aria-hidden
          className="absolute top-1.5 bottom-1.5 left-0 w-[2px] rounded-full bg-primary"
        />
      ) : null}
      {icon ? <span className="flex h-4 w-4 items-center justify-center">{icon}</span> : null}
      <span className="flex-1 truncate text-left">{label}</span>
      {count !== undefined && count > 0 ? (
        <span className="numeric text-[11px] text-ink-3">{count}</span>
      ) : null}
    </button>
  )
}

interface SidebarProps {
  filter: QueryFilter
  facets: Facets
  status: LibraryStatus | null
  onFilterChange: (next: QueryFilter) => void
  /** Kayıtlı görünüm hem filtreyi hem kipi değiştirir. */
  onSavedView: (view: SavedView) => void
  onReindex: () => void
}

/**
 * Sol ray: türler → kaynaklar → kayıtlı görünümler → etiketler.
 * Sayaçlar **tüm korpus** üzerinden gelir (filtrelenmiş sonuç değil) — bir türe
 * tıklayınca diğerlerinin sayısı değişmesin, gezinme referansı sabit kalsın.
 */
export function Sidebar({
  filter,
  facets,
  status,
  onFilterChange,
  onSavedView,
  onReindex,
}: SidebarProps): ReactNode {
  const activeType = filter.types?.length === 1 ? filter.types[0] : undefined
  const activeSource = filter.sources?.length === 1 ? filter.sources[0] : undefined
  const isAll =
    !filter.types?.length &&
    !filter.sources?.length &&
    !filter.statuses?.length &&
    !filter.tags?.length &&
    !filter.from

  const setType = (type: EntryType): void => {
    onFilterChange(
      activeType === type
        ? { sort: filter.sort, text: filter.text }
        : { sort: filter.sort, text: filter.text, types: [type] },
    )
  }

  const failures = status?.failures ?? []
  const orphans = status?.orphanTracking ?? []
  const collisions = status?.collisions ?? []

  return (
    <aside className="surface-chrome flex h-full w-full flex-col overflow-hidden border-r border-border">
      <div className="flex-1 overflow-y-auto px-2 pb-2">
        <div className="pt-2">
          <RailItem
            label="Tümü"
            count={status?.count}
            active={isAll}
            icon={<Layers size={14} strokeWidth={1.5} />}
            onClick={() => onFilterChange({ sort: filter.sort })}
          />
        </div>

        <SectionLabel>Türler</SectionLabel>
        {ENTRY_TYPES.map((type) => (
          <RailItem
            key={type}
            label={TYPE_META[type].label}
            count={facets.types[type] ?? 0}
            active={activeType === type}
            onClick={() => setType(type)}
          />
        ))}

        {status && status.sources.length > 1 ? (
          <>
            <SectionLabel>Kaynaklar</SectionLabel>
            {status.sources.map((source) => (
              <RailItem
                key={source.id}
                label={source.label}
                count={source.count}
                active={activeSource === source.id}
                onClick={() =>
                  onFilterChange(
                    activeSource === source.id
                      ? { sort: filter.sort, text: filter.text }
                      : { sort: filter.sort, text: filter.text, sources: [source.id] },
                  )
                }
              />
            ))}
          </>
        ) : null}

        <SectionLabel>Görünümler</SectionLabel>
        {SAVED_VIEWS.map((view) => (
          <RailItem
            key={view.id}
            label={view.label}
            count={countForView(view, facets)}
            icon={<Star size={13} strokeWidth={1.5} />}
            onClick={() => onSavedView(view)}
          />
        ))}

        {facets.tags.length > 0 ? (
          <>
            <SectionLabel>Etiketler</SectionLabel>
            {facets.tags.slice(0, 12).map(({ tag, count }) => (
              <RailItem
                key={tag}
                label={tag}
                count={count}
                icon={<Hash size={13} strokeWidth={1.5} />}
                active={filter.tags?.includes(tag)}
                onClick={() =>
                  onFilterChange(
                    filter.tags?.includes(tag)
                      ? { ...filter, tags: filter.tags.filter((t) => t !== tag) }
                      : { ...filter, tags: [...(filter.tags ?? []), tag] },
                  )
                }
              />
            ))}
          </>
        ) : null}
      </div>

      <div className="border-t border-border px-3 py-2">
        {orphans.length > 0 ? (
          <div
            className="mb-1.5 flex items-start gap-1.5 text-[11px] text-warning"
            title={`Kaynağını kaybeden takip kayıtları:\n${orphans.join('\n')}`}
          >
            <Unlink size={12} strokeWidth={1.5} className="mt-px shrink-0" />
            <span>{orphans.length} takip kaydı kaynağını kaybetti</span>
          </div>
        ) : null}
        {collisions.length > 0 ? (
          <div
            className="mb-1.5 flex items-start gap-1.5 text-[11px] text-warning"
            title={`Aynı id iki dosyada:\n${collisions.join('\n')}`}
          >
            <Copy size={12} strokeWidth={1.5} className="mt-px shrink-0" />
            <span>{collisions.length} kayıt id'si çakışıyor</span>
          </div>
        ) : null}
        {failures.length > 0 ? (
          <div
            className="mb-1.5 flex items-start gap-1.5 text-[11px] text-warning"
            title={failures.map((f) => `${f.path}: ${f.errors.join(', ')}`).join('\n')}
          >
            <AlertTriangle size={12} strokeWidth={1.5} className="mt-px shrink-0" />
            <span>{failures.length} dosya şemaya uymuyor</span>
          </div>
        ) : null}
        <button
          type="button"
          onClick={onReindex}
          className="flex w-full items-center gap-1.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
          title="Yeniden indeksle (⌘⇧R)"
        >
          {status?.indexing ? (
            <Loader2 size={12} strokeWidth={1.5} className="animate-spin" />
          ) : (
            <RefreshCw size={12} strokeWidth={1.5} />
          )}
          <span className="numeric">
            {status?.indexing
              ? 'indeksleniyor…'
              : `${(status?.count ?? 0).toLocaleString('tr')} kayıt · güncel`}
          </span>
        </button>
      </div>
    </aside>
  )
}
