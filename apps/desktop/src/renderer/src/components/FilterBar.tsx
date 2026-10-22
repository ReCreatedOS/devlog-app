import { type ReactNode, type RefObject } from 'react'
import {
  ENTRY_TYPES,
  SEVERITIES,
  SEVERITY_LABEL,
  STATUSES,
  STATUS_LABEL,
  TYPE_META,
} from '@devlog/core/shared'
import type { EntryStatus, EntryType, Facets, QueryFilter, Severity } from '@devlog/core/shared'
import {
  ArrowDownWideNarrow,
  ArrowUpWideNarrow,
  CalendarDays,
  List,
  ListChecks,
  Search,
  X,
} from 'lucide-react'
import { cn } from '../lib/cn'
import { SEVERITY_DOT, daysAgoKey, todayKey } from '../lib/format'
import { Dropdown } from './Dropdown'
import { IconButton } from './primitives'

const RANGES = [
  { id: 'today', label: 'Bugün', from: () => todayKey() },
  { id: '7d', label: '7 gün', from: () => daysAgoKey(7) },
  { id: '30d', label: '30 gün', from: () => daysAgoKey(30) },
] as const

export type Density = 'compact' | 'comfortable'
export type ListView = 'list' | 'tracker' | 'calendar'

interface FilterBarProps {
  filter: QueryFilter
  facets: Facets
  total: number
  density: Density
  view: ListView
  searchRef: RefObject<HTMLInputElement | null>
  onFilterChange: (next: QueryFilter) => void
  onDensityChange: (next: Density) => void
  onViewChange: (next: ListView) => void
}

export function FilterBar({
  filter,
  facets,
  total,
  density,
  view,
  searchRef,
  onFilterChange,
  onDensityChange,
  onViewChange,
}: FilterBarProps): ReactNode {
  const activeRange = RANGES.find((r) => r.from() === filter.from)
  const hasFilters = Boolean(
    filter.text ||
      filter.types?.length ||
      filter.severities?.length ||
      filter.statuses?.length ||
      filter.tags?.length ||
      filter.from,
  )

  return (
    <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border bg-background px-3">
      <div className="relative flex h-7 flex-1 items-center">
        <Search
          size={13}
          strokeWidth={1.5}
          className="pointer-events-none absolute left-2 text-muted-foreground"
        />
        <input
          ref={searchRef}
          value={filter.text ?? ''}
          onChange={(event) => onFilterChange({ ...filter, text: event.target.value })}
          placeholder="Ara…"
          spellCheck={false}
          className={cn(
            'h-7 w-full rounded-xs border border-transparent bg-surface-1 pr-7 pl-7 text-[13px]',
            'placeholder:text-muted-foreground/70 focus:border-border-strong focus:bg-surface-2 focus:outline-none',
          )}
        />
        {filter.text ? (
          <button
            type="button"
            onClick={() => onFilterChange({ ...filter, text: '' })}
            className="absolute right-1.5 text-muted-foreground hover:text-foreground"
          >
            <X size={13} strokeWidth={1.5} />
          </button>
        ) : null}
      </div>

      <Dropdown<Severity>
        label="Severity"
        selected={filter.severities ?? []}
        onChange={(next) => onFilterChange({ ...filter, severities: next })}
        options={SEVERITIES.map((value) => ({
          value,
          label: SEVERITY_LABEL[value],
          dot: SEVERITY_DOT[value],
          count: facets.severities[value] ?? 0,
        }))}
      />

      <Dropdown<EntryType>
        label="Tür"
        selected={filter.types ?? []}
        onChange={(next) => onFilterChange({ ...filter, types: next })}
        options={ENTRY_TYPES.map((value) => ({
          value,
          label: TYPE_META[value].label,
          count: facets.types[value] ?? 0,
        }))}
      />

      <Dropdown<EntryStatus>
        label="Durum"
        selected={filter.statuses ?? []}
        onChange={(next) => onFilterChange({ ...filter, statuses: next })}
        options={STATUSES.map((value) => ({
          value,
          label: STATUS_LABEL[value],
          count: facets.statuses[value] ?? 0,
        }))}
      />

      <div className="flex h-7 items-center rounded-xs border border-border p-px">
        {RANGES.map((range) => (
          <button
            key={range.id}
            type="button"
            onClick={() =>
              onFilterChange({
                ...filter,
                from: activeRange?.id === range.id ? undefined : range.from(),
              })
            }
            className={cn(
              'h-full rounded-[5px] px-2 text-[12px] transition-colors duration-150',
              activeRange?.id === range.id
                ? 'bg-surface-2 text-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {range.label}
          </button>
        ))}
      </div>

      {hasFilters ? (
        <IconButton
          onClick={() => onFilterChange({ sort: filter.sort })}
          title="Filtreleri temizle (Esc)"
        >
          <X size={14} strokeWidth={1.5} />
        </IconButton>
      ) : null}

      <div className="ml-auto flex items-center gap-1.5">
        <span className="numeric text-[11px] text-muted-foreground">
          {total.toLocaleString('tr')} kayıt
        </span>

        <IconButton
          onClick={() =>
            onFilterChange({ ...filter, sort: filter.sort === 'oldest' ? 'newest' : 'oldest' })
          }
          title={filter.sort === 'oldest' ? 'Eskiden yeniye' : 'Yeniden eskiye'}
        >
          {filter.sort === 'oldest' ? (
            <ArrowUpWideNarrow size={14} strokeWidth={1.5} />
          ) : (
            <ArrowDownWideNarrow size={14} strokeWidth={1.5} />
          )}
        </IconButton>

        <IconButton
          onClick={() => onDensityChange(density === 'compact' ? 'comfortable' : 'compact')}
          title={density === 'compact' ? 'Rahat görünüm' : 'Sıkı görünüm'}
          active={density === 'comfortable'}
        >
          <List size={14} strokeWidth={1.5} />
        </IconButton>

        {/* Üç kip: ne oldu (liste) · ne duruyor (takip) · ne zaman (takvim). */}
        <div className="flex h-7 items-center rounded-xs border border-border p-px">
          {(
            [
              { id: 'list', icon: <List size={13} strokeWidth={1.5} />, title: 'Liste — ne oldu' },
              {
                id: 'tracker',
                icon: <ListChecks size={13} strokeWidth={1.5} />,
                title: 'Takip — ne duruyor (açık, devam eden, izlemedeki kayıtlar)',
              },
              {
                id: 'calendar',
                icon: <CalendarDays size={13} strokeWidth={1.5} />,
                title: 'Takvim — ne zaman',
              },
            ] as const
          ).map((mode) => (
            <button
              key={mode.id}
              type="button"
              onClick={() => onViewChange(mode.id)}
              title={mode.title}
              className={cn(
                'flex h-full items-center rounded-[5px] px-1.5 transition-colors duration-150',
                view === mode.id
                  ? 'bg-surface-2 text-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {mode.icon}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
