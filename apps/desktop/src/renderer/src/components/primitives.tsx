import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { cn } from '../lib/cn'

export function IconButton({
  className,
  active,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }): ReactNode {
  return (
    <button
      type="button"
      className={cn(
        'no-drag inline-flex h-7 w-7 items-center justify-center rounded-xs text-muted-foreground',
        'transition-colors duration-150 hover:bg-surface-2 hover:text-foreground',
        'disabled:pointer-events-none disabled:opacity-40',
        active && 'bg-surface-2 text-foreground',
        className,
      )}
      {...props}
    />
  )
}

export function Button({
  className,
  variant = 'ghost',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'ghost' | 'primary' | 'outline' | 'danger'
}): ReactNode {
  return (
    <button
      type="button"
      className={cn(
        'no-drag inline-flex h-8 items-center gap-1.5 rounded-sm px-2.5 text-[13px] font-medium',
        'transition-colors duration-150 disabled:pointer-events-none disabled:opacity-40',
        variant === 'ghost' && 'text-muted-foreground hover:bg-surface-2 hover:text-foreground',
        variant === 'outline' &&
          'border border-border text-foreground hover:border-border-strong hover:bg-surface-2',
        variant === 'primary' && 'bg-primary text-primary-foreground hover:brightness-110',
        variant === 'danger' && 'text-destructive hover:bg-destructive/10',
        className,
      )}
      {...props}
    />
  )
}

/** Klavye kısayolu rozeti. */
export function Kbd({ children }: { children: ReactNode }): ReactNode {
  return (
    <kbd className="numeric rounded-2xs border border-border bg-surface-2 px-1 py-px font-sans text-[10px] font-medium text-muted-foreground">
      {children}
    </kbd>
  )
}

export function SectionLabel({ children }: { children: ReactNode }): ReactNode {
  return (
    <div className="flex items-center gap-2 px-2 pt-5 pb-1.5">
      <span className="text-[10px] font-semibold tracking-[0.08em] text-ink-3 uppercase">
        {children}
      </span>
      <span aria-hidden className="day-rule h-px flex-1" />
    </div>
  )
}

export function EmptyState({
  title,
  hint,
  icon,
}: {
  title: string
  hint?: ReactNode
  icon?: ReactNode
}): ReactNode {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center">
      {icon ? (
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-tint-1 text-ink-3">
          {icon}
        </div>
      ) : null}
      <div className="t-head text-ink">{title}</div>
      {hint ? <div className="max-w-sm text-[13px] leading-relaxed text-ink-2">{hint}</div> : null}
    </div>
  )
}

export function SkeletonRows({ count = 8 }: { count?: number }): ReactNode {
  return (
    <div className="space-y-px px-2 py-2">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="flex h-9 items-center gap-3 rounded-md px-2">
          <div className="h-2 w-2 animate-pulse rounded-full bg-surface-2" />
          <div className="h-3 w-10 animate-pulse rounded-2xs bg-surface-2" />
          <div className="h-3 w-12 animate-pulse rounded-2xs bg-surface-2" />
          <div
            className="h-3 animate-pulse rounded-2xs bg-surface-2"
            style={{ width: `${30 + ((i * 13) % 45)}%` }}
          />
        </div>
      ))}
    </div>
  )
}
