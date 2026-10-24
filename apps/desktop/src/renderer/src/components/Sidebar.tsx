import type { ReactNode } from 'react'
import { ENTRY_TYPES, SAVED_VIEWS, TYPE_META } from '@devlog/core/shared'
import type { EntryType, Facets, QueryFilter, SavedView } from '@devlog/core/shared'
import {
  AlertTriangle,
  ArrowDownUp,
  CloudOff,
  Copy,
  Hash,
  Layers,
  Loader2,
  RefreshCw,
  ShieldAlert,
  Star,
  Unlink,
  Users,
} from 'lucide-react'
import { cn } from '../lib/cn'
import { relativeTime } from '../lib/format'
/**
 * Kayıtlı görünümün sayacı. Bayatlık sayısı korpus taraması gerektirdiği için
 * burada hesaplanmaz — o rakam takip kipinin kendi şeridinde çıkar.
 */
function countForView(view: SavedView, facets: Facets): number | undefined {
  const statuses = view.filter.statuses
  if (!statuses?.length) return undefined
  return statuses.reduce((total, status) => total + (facets.statuses[status] ?? 0), 0)
}
import type { LibraryStatus, TeamStatus } from '../../../shared/ipc.js'
import { SectionLabel } from './primitives'

interface RailItemProps {
  label: string
  count?: number
  active?: boolean
  icon?: ReactNode
  /** Sayacın sağında duran durum işareti (ör. takım eşitlemesi). */
  trailing?: ReactNode
  title?: string
  onClick: () => void
}

function RailItem({ label, count, active, icon, trailing, title, onClick }: RailItemProps): ReactNode {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
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
      {trailing}
    </button>
  )
}

/**
 * Takım satırının durum işareti. Her şey yolundaysa hiçbir şey çizilmez:
 * bu rayda renk "dikkat" demek, "güncel" sessizliktir.
 */
function teamSignal(team: TeamStatus): { icon: ReactNode; title: string } {
  const last = team.lastSync
  const base = `${team.label} · @${team.author}`
  if (team.syncing) {
    return {
      icon: <Loader2 size={12} strokeWidth={1.5} className="animate-spin text-ink-3" />,
      title: `${base}\neşitleniyor…`,
    }
  }
  if (!last) return { icon: null, title: `${base}\nhenüz eşitlenmedi` }
  const when = `son eşitleme ${relativeTime(last.at)}`
  if (last.blocked.length > 0) {
    return {
      icon: <ShieldAlert size={12} strokeWidth={1.5} className="text-warning" />,
      title:
        `${base}\n${last.blocked.length} dosya sır taşıdığı için İTİLMEDİ:\n` +
        last.blocked.map((item) => `${item.path} (${item.found.join(', ')})`).join('\n'),
    }
  }
  if (last.error) {
    return {
      icon: <AlertTriangle size={12} strokeWidth={1.5} className="text-warning" />,
      title: `${base}\n${last.error}\n${when}`,
    }
  }
  if (last.pending) {
    return {
      icon: <CloudOff size={12} strokeWidth={1.5} className="text-ink-3" />,
      title: `${base}\nitilmeyi bekleyen yerel kayıt var · ${when}`,
    }
  }
  return { icon: null, title: `${base}\n${when}` }
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

  const teams = status?.teams ?? []
  const teamSourceIds = new Set(teams.map((team) => `team:${team.id}`))
  const otherSources = (status?.sources ?? []).filter((source) => !teamSourceIds.has(source.id))
  const lastTeamSync = teams
    .map((team) => team.lastSync?.at)
    .filter((at): at is string => Boolean(at))
    .sort()
    .at(-1)
  const teamSyncing = teams.some((team) => team.syncing)
  const toggleSource = (id: string): void =>
    onFilterChange(
      activeSource === id
        ? { sort: filter.sort, text: filter.text }
        : { sort: filter.sort, text: filter.text, sources: [id] },
    )

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

        {teams.some((team) => team.enabled) ? (
          <>
            <SectionLabel>Takım</SectionLabel>
            {teams
              .filter((team) => team.enabled)
              .map((team) => {
                const id = `team:${team.id}`
                const signal = teamSignal(team)
                return (
                  <RailItem
                    key={id}
                    label={team.label}
                    count={status?.sources.find((source) => source.id === id)?.count}
                    active={activeSource === id}
                    icon={<Users size={13} strokeWidth={1.5} />}
                    trailing={signal.icon}
                    title={signal.title}
                    onClick={() => toggleSource(id)}
                  />
                )
              })}
          </>
        ) : null}

        {otherSources.length > 1 ? (
          <>
            <SectionLabel>Kaynaklar</SectionLabel>
            {otherSources.map((source) => (
              <RailItem
                key={source.id}
                label={source.label}
                count={source.count}
                active={activeSource === source.id}
                onClick={() => toggleSource(source.id)}
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
        {teams.some((team) => team.enabled) ? (
          <button
            type="button"
            onClick={() => void window.devlog.sync()}
            className="mb-1 flex w-full items-center gap-1.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
            title="Takım feed'ini şimdi eşitle (otomatik: 30 sn'de bir ve pencereye dönüşte)"
          >
            {teamSyncing ? (
              <Loader2 size={12} strokeWidth={1.5} className="animate-spin" />
            ) : (
              <ArrowDownUp size={12} strokeWidth={1.5} />
            )}
            <span className="numeric">
              {teamSyncing
                ? 'eşitleniyor…'
                : lastTeamSync
                  ? `takım · ${relativeTime(lastTeamSync)}`
                  : 'takım · eşitlenmedi'}
            </span>
          </button>
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
