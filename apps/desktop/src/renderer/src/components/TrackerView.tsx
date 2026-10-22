import { useMemo, type ReactNode } from 'react'
import { ACTIVE_STATUSES, STATUS_LABEL, compareTracked, trackingState } from '@devlog/core/shared'
import type { EntryStatus, EntrySummary } from '@devlog/core/shared'
import { AlarmClock, CheckCircle2, CornerDownRight, Hourglass, Pin } from 'lucide-react'
import { cn } from '../lib/cn'
import { SEVERITY_RAIL, STATUS_TONE } from '../lib/format'
import { TypeBadge } from './badges'

import { EmptyState } from './primitives'
import { RowMenu } from './RowMenu'
import { StatusMenu } from './StatusMenu'

interface TrackerViewProps {
  items: EntrySummary[]
  selectedId: string | null
  onSelect: (id: string) => void
  onStatusChange: (id: string, next: EntryStatus | null) => void
  onPinToggle: (id: string, pinned: boolean) => void
  onDelete: (id: string) => void
}

/**
 * Takip görünümü — defterin şimdiki zaman kipi.
 *
 * Liste görünümü "ne oldu" sorusunu tarih sırasıyla cevaplar; burası "ne
 * duruyor" sorusunu cevaplar. Bu yüzden sıralama tarih değil ACİLİYETTİR:
 * gözden geçirme günü gelenler → bayatlar → sabitlenmişler → severity → yaş.
 * İlk satır her zaman bugün bakılması gereken şeydir.
 */
export function TrackerView({
  items,
  selectedId,
  onSelect,
  onStatusChange,
  onPinToggle,
  onDelete,
}: TrackerViewProps): ReactNode {
  const groups = useMemo(() => {
    const now = new Date()
    return ACTIVE_STATUSES.map((status) => ({
      status,
      rows: items
        .filter((item) => item.status === status)
        .sort((a, b) => compareTracked(a, b, now)),
    })).filter((group) => group.rows.length > 0)
  }, [items])

  const attention = useMemo(() => {
    const now = new Date()
    return items.filter((item) => {
      const state = trackingState(item, now)
      return state.stale || state.reviewDue
    }).length
  }, [items])

  if (groups.length === 0) {
    return (
      <EmptyState
        icon={<CheckCircle2 size={28} strokeWidth={1.2} />}
        title="Takipte bir şey yok"
        hint={
          <>
            Açık, devam eden, bloke ya da izlemedeki kayıt bulunmuyor. Bir kaydın
            durumunu değiştirdiğinde burada belirir.
          </>
        }
      />
    )
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      {attention > 0 ? (
        <div className="flex items-center gap-2 border-b border-border bg-warning/5 px-3 py-2 text-[12px]">
          <AlarmClock size={13} strokeWidth={1.5} className="shrink-0 text-warning" />
          <span className="text-foreground/85">
            <span className="numeric font-medium">{attention}</span> kayıt bugün bakılmayı
            bekliyor
          </span>
          <span className="text-muted-foreground">— bayatlamış ya da gözden geçirme günü geldi</span>
        </div>
      ) : null}

      {groups.map((group) => (
        <section key={group.status}>
          <header className="sticky top-0 z-10 flex items-center gap-2 border-b border-border bg-background/95 px-3 py-1.5 backdrop-blur-sm">
            <span
              className={cn(
                'inline-flex h-[18px] items-center rounded-2xs border px-1.5 text-[10px] font-medium',
                STATUS_TONE[group.status],
              )}
            >
              {STATUS_LABEL[group.status]}
            </span>
            <span className="numeric text-[11px] text-muted-foreground">{group.rows.length}</span>
          </header>

          {group.rows.map((entry) => (
            <TrackerRow
              key={entry.id}
              entry={entry}
              selected={entry.id === selectedId}
              onSelect={onSelect}
              onStatusChange={onStatusChange}
              onPinToggle={onPinToggle}
              onDelete={onDelete}
            />
          ))}
        </section>
      ))}
    </div>
  )
}

interface TrackerRowProps {
  entry: EntrySummary
  selected: boolean
  onSelect: (id: string) => void
  onStatusChange: (id: string, next: EntryStatus | null) => void
  onPinToggle: (id: string, pinned: boolean) => void
  onDelete: (id: string) => void
}

function TrackerRow({
  entry,
  selected,
  onSelect,
  onStatusChange,
  onPinToggle,
  onDelete,
}: TrackerRowProps): ReactNode {
  const state = trackingState(entry)
  const derived = entry.derived?.includes('status')

  return (
    <div
      role="button"
      tabIndex={-1}
      onClick={() => onSelect(entry.id)}
      className={cn(
        'relative flex cursor-default items-start gap-2.5 border-b border-border/60 py-2 pr-3 pl-[11px]',
        'transition-[background-color] duration-100',
        selected ? 'bg-tint-2' : 'hover:bg-tint-1',
      )}
    >
      <span
        aria-hidden
        className={cn(
          'absolute inset-y-0 left-0 w-[3px]',
          entry.severity ? SEVERITY_RAIL[entry.severity] : 'bg-transparent',
          selected && 'brightness-125',
        )}
      />

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          {entry.pinned ? (
            <Pin size={11} strokeWidth={1.75} className="shrink-0 text-primary" />
          ) : null}
          <span className={cn('t-title truncate', selected ? 'text-ink' : 'text-ink/90')}>
            {entry.title}
          </span>
        </div>

        {entry.next_action ? (
          <div className="mt-1 flex items-start gap-1 text-[12px] leading-snug text-ink-2">
            <CornerDownRight size={11} strokeWidth={1.5} className="mt-0.5 shrink-0" />
            <span className="line-clamp-2">{entry.next_action}</span>
          </div>
        ) : (
          <div className="mt-1 text-[12px] text-muted-foreground/60 italic">
            sıradaki adım yazılmamış
          </div>
        )}

        <div className="t-machine mt-1 flex flex-wrap items-center gap-2 text-ink-3">
          <TypeBadge type={entry.type} />
          {entry.area ? <span>· {entry.area}</span> : null}
          <span
            className={cn('inline-flex items-center gap-1', state.stale && 'text-warning')}
            title={
              state.stale
                ? `${STATUS_LABEL[entry.status ?? 'open']} için eşik ${state.thresholdDays} gün — aşıldı`
                : `Bu duruma girdiğinden beri (eşik ${state.thresholdDays} gün)`
            }
          >
            <Hourglass size={10} strokeWidth={1.5} />
            <span>{state.ageDays} gün</span>
          </span>
          {state.reviewDue ? (
            <span className="inline-flex items-center gap-1 text-warning">
              <AlarmClock size={10} strokeWidth={1.5} />
              gözden geçir
            </span>
          ) : entry.next_review ? (
            <span className="numeric">· {entry.next_review} bakılacak</span>
          ) : null}
        </div>
      </div>

      <div
        className="flex shrink-0 items-center gap-1 pt-0.5"
        onClick={(event) => event.stopPropagation()}
      >
        <StatusMenu
          status={entry.status}
          derived={derived}
          mirrored={entry.readOnly}
          compact
          onChange={(next) => onStatusChange(entry.id, next)}
        />
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
