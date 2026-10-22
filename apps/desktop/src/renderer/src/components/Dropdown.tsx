import { useCallback, useRef, useState, type ReactNode } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { cn } from '../lib/cn'
import { Popover } from './Popover'

export interface DropdownOption<T extends string> {
  value: T
  label: string
  /** Sol tarafta gösterilen renk noktası (severity/durum için). */
  dot?: string
  count?: number
}

interface DropdownProps<T extends string> {
  label: string
  options: Array<DropdownOption<T>>
  selected: T[]
  onChange: (next: T[]) => void
  /** Tek seçim modunda seçilen değer çipin etiketini değiştirir. */
  single?: boolean
}

/**
 * Çok seçimli filtre çipi. Radix yerine elle yazıldı — tek bir açılır liste için
 * bir bağımlılık taşımaya değmez ve davranışı tam kontrol ediyoruz.
 */
export function Dropdown<T extends string>({
  label,
  options,
  selected,
  onChange,
  single,
}: DropdownProps<T>): ReactNode {
  const [open, setOpen] = useState(false)
  const anchorRef = useRef<HTMLButtonElement | null>(null)
  const close = useCallback(() => setOpen(false), [])

  const toggle = (value: T): void => {
    if (single) {
      onChange(selected[0] === value ? [] : [value])
      setOpen(false)
      return
    }
    onChange(
      selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value],
    )
  }

  const activeLabel =
    selected.length === 0
      ? label
      : single
        ? (options.find((o) => o.value === selected[0])?.label ?? label)
        : `${label} · ${selected.length}`

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'flex h-7 items-center gap-1 rounded-xs border px-2 text-[12px] transition-colors duration-150',
          selected.length > 0
            ? 'border-primary/40 bg-primary/10 text-foreground'
            : 'border-border text-muted-foreground hover:border-border-strong hover:text-foreground',
        )}
      >
        {activeLabel}
        <ChevronDown size={12} strokeWidth={1.5} />
      </button>

      <Popover open={open} anchorRef={anchorRef} onClose={close} align="left" className="min-w-44">
        {options.map((option) => {
          const isSelected = selected.includes(option.value)
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => toggle(option.value)}
              className="flex h-7 w-full items-center gap-2 rounded-sm px-2 text-[13px] text-foreground transition-colors hover:bg-surface-2"
            >
              <span className="flex h-3.5 w-3.5 items-center justify-center">
                {isSelected ? (
                  <Check size={12} strokeWidth={2} className="text-primary" />
                ) : option.dot ? (
                  <span className={cn('h-2 w-2 rounded-full', option.dot)} />
                ) : null}
              </span>
              <span className="flex-1 truncate text-left">{option.label}</span>
              {option.count !== undefined ? (
                <span className="numeric text-[11px] text-muted-foreground/70">{option.count}</span>
              ) : null}
            </button>
          )
        })}
      </Popover>
    </>
  )
}
