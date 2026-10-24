import { useEffect, useMemo, useRef, type ReactNode } from 'react'
import type { EntryStatus, EntrySummary } from '@devlog/core/shared'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Link2, Lock } from 'lucide-react'
import { cn } from '../lib/cn'
import { SEVERITY_RAIL, dayHeading, dayKey, timeOfDay } from '../lib/format'
import { TagChip, TypeBadge } from './badges'
import { RowMenu } from './RowMenu'
import { StatusMenu } from './StatusMenu'
import type { Density } from './FilterBar'

type Row =
  | { kind: 'day'; key: string; count: number }
  | { kind: 'entry'; key: string; entry: EntrySummary }

const DAY_ROW_HEIGHT = 28
const COMPACT_ROW_HEIGHT = 32
const COMFORTABLE_ROW_HEIGHT = 48

function buildRows(items: EntrySummary[]): Row[] {
  const rows: Row[] = []
  let currentDay: string | null = null
  let dayIndex = -1
  for (const entry of items) {
    const key = dayKey(entry.occurred_at)
    if (key !== currentDay) {
      currentDay = key
      rows.push({ kind: 'day', key, count: 0 })
      dayIndex = rows.length - 1
    }
    const header = rows[dayIndex]
    if (header && header.kind === 'day') header.count += 1
    rows.push({ kind: 'entry', key: entry.id, entry })
  }
  return rows
}

interface EntryListProps {
  items: EntrySummary[]
  selectedId: string | null
  density: Density
  onSelect: (id: string) => void
  onTagClick: (tag: string) => void
  onStatusChange: (id: string, next: EntryStatus | null) => void
  onPinToggle: (id: string, pinned: boolean) => void
  onDelete: (id: string) => void
  /** Takım arkadaşlarından az önce gelen kayıtlar — kısa bir süre işaretlenir. */
  arrivedIds?: ReadonlySet<string>
}

/**
 * Gün başlıklarıyla gruplanmış, sanallaştırılmış kayıt listesi.
 *
 * Bu uygulama web'deki "belge kök-scroller" kuralına tabi DEĞİL: burada
 * Chromium gömülü, Safari geri-kaydırma jesti yok. Panel içi kaydırma +
 * `getScrollElement` doğru tercih.
 */
export function EntryList({
  items,
  selectedId,
  density,
  onSelect,
  onTagClick,
  onStatusChange,
  onPinToggle,
  onDelete,
  arrivedIds,
}: EntryListProps): ReactNode {
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const rows = useMemo(() => buildRows(items), [items])
  const entryHeight = density === 'comfortable' ? COMFORTABLE_ROW_HEIGHT : COMPACT_ROW_HEIGHT

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => (rows[index]?.kind === 'day' ? DAY_ROW_HEIGHT : entryHeight),
    getItemKey: (index) => rows[index]?.key ?? index,
    overscan: 14,
  })

  // Klavyeyle (j/k) seçim değişince satırı görünür alana çek.
  useEffect(() => {
    if (!selectedId) return
    const index = rows.findIndex((row) => row.kind === 'entry' && row.entry.id === selectedId)
    if (index >= 0) virtualizer.scrollToIndex(index, { align: 'auto' })
  }, [selectedId, rows, virtualizer])

  const virtualRows = virtualizer.getVirtualItems()
  // Yapışkan başlık: görünür ilk satırın gününü tepeye sabitler.
  const pinnedDay = (() => {
    const first = virtualRows[0]
    if (!first) return null
    const row = rows[first.index]
    if (!row) return null
    return row.kind === 'day' ? row.key : dayKey(row.entry.occurred_at)
  })()

  return (
    <div className="relative min-h-0 flex-1">
      {pinnedDay ? (
        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex h-[28px] items-center bg-background/92 px-3 text-[11px] font-semibold tracking-[0.03em] text-ink-2 uppercase backdrop-blur-sm">
          {dayHeading(pinnedDay)}
        </div>
      ) : null}

      <div ref={scrollRef} className="scroll-quiet h-full overflow-y-auto">
        <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
          {virtualRows.map((virtualRow) => {
            const row = rows[virtualRow.index]
            if (!row) return null
            return (
              <div
                key={virtualRow.key}
                className="absolute inset-x-0 top-0"
                style={{ height: virtualRow.size, transform: `translateY(${virtualRow.start}px)` }}
              >
                {row.kind === 'day' ? (
                  <div className="flex h-full items-center gap-2 px-3">
                    <span className="text-[10px] font-semibold tracking-[0.08em] text-ink-2 uppercase">
                      {dayHeading(row.key)}
                    </span>
                    <span className="numeric text-[11px] text-ink-3">{row.count}</span>
                    <span aria-hidden className="day-rule ml-1 h-px flex-1" />
                  </div>
                ) : (
                  <EntryRow
                    entry={row.entry}
                    selected={row.entry.id === selectedId}
                    density={density}
                    onSelect={onSelect}
                    onTagClick={onTagClick}
                    onStatusChange={onStatusChange}
                    onPinToggle={onPinToggle}
                    onDelete={onDelete}
                    arrived={arrivedIds?.has(row.entry.id) ?? false}
                  />
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

interface EntryRowProps {
  entry: EntrySummary
  selected: boolean
  density: Density
  onSelect: (id: string) => void
  onTagClick: (tag: string) => void
  onStatusChange: (id: string, next: EntryStatus | null) => void
  onPinToggle: (id: string, pinned: boolean) => void
  onDelete: (id: string) => void
  arrived: boolean
}

function EntryRow({
  entry,
  selected,
  density,
  onSelect,
  onTagClick,
  onStatusChange,
  onPinToggle,
  onDelete,
  arrived,
}: EntryRowProps): ReactNode {
  const derivedStatus = entry.derived?.includes('status')
  return (
    <div
      role="button"
      tabIndex={-1}
      onClick={() => onSelect(entry.id)}
      className={cn(
        'group relative flex h-full cursor-default items-center gap-2.5 pr-3 pl-[11px]',
        'transition-[background-color] duration-100',
        selected ? 'row-selected' : 'hover:bg-tint-1',
        arrived && 'row-arrived',
      )}
    >
      {/*
        Severity oluğu: eskiden solda marka renginde bir "seçili" çubuğu ve ayrıca
        bir severity noktası vardı — yani en değerli kenar, durumu değil SEÇİMİ
        anlatıyordu. Artık şerit sürekli ve severity'yi taşıyor; seçim zemin
        tintiyle söyleniyor. Renk yeniden yalnız aciliyet demek.
      */}
      <span
        aria-hidden
        title={entry.severity ?? undefined}
        className={cn(
          'absolute inset-y-0 left-0 w-[3px]',
          entry.severity ? SEVERITY_RAIL[entry.severity] : 'bg-transparent',
          selected && 'brightness-125',
        )}
      />
      <span className="numeric w-[38px] shrink-0 text-[11.5px] tracking-[0.01em] text-ink-3">
        {timeOfDay(entry.occurred_at)}
      </span>
      <TypeBadge type={entry.type} />

      {/* Oluk: solu "ne zaman/ne tür", sağı yazının kendisi. Gün başlıklarında
          çizilmez — çizgi gün sınırında kırılır, listeye ritmi o verir. */}
      <span aria-hidden className="gutter-rule -my-1 h-[calc(100%+0.5rem)] self-stretch" />

      <div className="min-w-0 flex-1">
        <div className={cn('t-title truncate', selected ? 'text-ink' : 'text-ink/90')}>
          {entry.title}
        </div>
        {density === 'comfortable' && entry.excerpt ? (
          <div className="mt-0.5 truncate text-[12px] leading-tight text-ink-3">
            {entry.excerpt}
          </div>
        ) : null}
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        {/* Yazar makine olgusu değil ama kimlik etiketi: kenar payının mono
            register'ında, etiketlerin solunda. Yalnız takım kayıtlarında var. */}
        {entry.author ? (
          <span className="numeric text-[11px] text-ink-3" title="Takım kaydı — yazarı">
            @{entry.author}
          </span>
        ) : null}
        {(entry.tags ?? []).slice(0, 2).map((tag) => (
          <span key={tag} onClick={(event) => event.stopPropagation()}>
            <TagChip tag={tag} onClick={() => onTagClick(tag)} />
          </span>
        ))}
        {entry.outboundLinks && entry.outboundLinks.length > 0 ? (
          <Link2
            size={12}
            strokeWidth={1.5}
            className="text-muted-foreground/50"
            aria-label={`${entry.outboundLinks.length} bağlantı`}
          />
        ) : null}
        {entry.readOnly ? (
          <Lock size={11} strokeWidth={1.5} className="text-muted-foreground/50" />
        ) : null}
        {/* Durum listeden de değiştirilebilir: en sık eylem için detay paneline
            gitmek gereksiz bir adımdı. */}
        {entry.status ? (
          <span onClick={(event) => event.stopPropagation()}>
            <StatusMenu
              status={entry.status}
              derived={derivedStatus}
              mirrored={entry.readOnly}
              compact
              onChange={(next) => onStatusChange(entry.id, next)}
            />
          </span>
        ) : null}
        <RowMenu
          entry={entry}
          onStatusChange={onStatusChange}
          onPinToggle={onPinToggle}
          onDelete={onDelete}
        />
      </div>
    </div>
  )
}
