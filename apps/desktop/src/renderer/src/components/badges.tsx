import type { ReactNode } from 'react'
import { SEVERITY_LABEL, TYPE_META } from '@devlog/core/shared'
import type { EntryType, Severity } from '@devlog/core/shared'
import { cn } from '../lib/cn'
import { SEVERITY_DOT } from '../lib/format'

export function SeverityDot({
  severity,
  className,
}: {
  severity?: Severity
  className?: string
}): ReactNode {
  return (
    <span
      title={severity ? SEVERITY_LABEL[severity] : 'Severity yok'}
      className={cn(
        'block h-2 w-2 shrink-0 rounded-full',
        severity ? SEVERITY_DOT[severity] : 'border border-border bg-transparent',
        className,
      )}
    />
  )
}

export function TypeBadge({ type }: { type: EntryType }): ReactNode {
  const meta = TYPE_META[type]
  return (
    <span
      // Kısaltma ezberlenecek bir şey olmamalı: üstüne gelince ne olduğunu söyler.
      title={`${meta.label} — ${meta.description}`}
      className={cn(
        'inline-flex h-[17px] w-[46px] shrink-0 items-center justify-center rounded-[5px]',
        'bg-tint-1 text-[9.5px] font-semibold tracking-[0.07em] text-ink-2 uppercase',
        'transition-colors duration-150 group-hover:bg-tint-2',
      )}
    >
      {meta.badge}
    </span>
  )
}

export function TagChip({ tag, onClick }: { tag: string; onClick?: () => void }): ReactNode {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className={cn(
        'hit inline-flex h-[18px] shrink-0 items-center rounded-[5px] bg-tint-1 px-1.5',
        'text-[10.5px] tracking-[0.01em] text-ink-3',
        'enabled:hover:bg-tint-2 enabled:hover:text-ink-2',
      )}
    >
      #{tag}
    </button>
  )
}
