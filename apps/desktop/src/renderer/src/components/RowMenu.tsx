import { useCallback, useRef, useState, type ReactNode } from 'react'
import { ACTIVE_STATUSES, STATUSES, STATUS_LABEL } from '@devlog/core/shared'
import type { EntryStatus, EntrySummary } from '@devlog/core/shared'
import { Check, Copy, FolderOpen, MoreVertical, Pin, PinOff, Trash2 } from 'lucide-react'
import { cn } from '../lib/cn'
import { STATUS_TONE } from '../lib/format'
import { Popover } from './Popover'

interface RowMenuProps {
  entry: EntrySummary
  onStatusChange: (id: string, next: EntryStatus | null) => void
  onPinToggle: (id: string, pinned: boolean) => void
  onDelete?: (id: string) => void
}

/**
 * Satırın kendi menüsü: durum atama + kayıt eylemleri tek yerde.
 *
 * Durum hapı da tıklanabilir, ama o yalnız DURUMU OLAN satırlarda görünür. Bu
 * menü her satırda aynı yerde durur — "durumu nereden değiştiriyordum"
 * sorusunun tek cevabı olsun diye.
 *
 * Katman `Popover` ile `document.body`'ye çizilir: liste sanallaştırılmış bir
 * kaydırma kabı ve kap içinde konumlanan menü kenarlarda kırpılıyordu.
 */
export function RowMenu({ entry, onStatusChange, onPinToggle, onDelete }: RowMenuProps): ReactNode {
  const [open, setOpen] = useState(false)
  const anchorRef = useRef<HTMLButtonElement | null>(null)
  const close = useCallback(() => setOpen(false), [])

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        onClick={(event) => {
          event.stopPropagation()
          setOpen((v) => !v)
        }}
        title="Kayıt menüsü"
        className={cn(
          'inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-2xs',
          'text-muted-foreground/60 transition-colors hover:bg-surface-2 hover:text-foreground',
          open && 'bg-surface-2 text-foreground',
        )}
      >
        <MoreVertical size={13} strokeWidth={1.75} />
      </button>

      <Popover open={open} anchorRef={anchorRef} onClose={close} align="right" className="min-w-56">
        <div className="px-2 pt-1 pb-1 text-[10px] font-semibold tracking-[0.04em] text-muted-foreground uppercase">
          Durum
        </div>
        {STATUSES.map((value, index) => (
          <button
            key={value}
            type="button"
            onClick={() => {
              onStatusChange(entry.id, value)
              close()
            }}
            className="flex h-7 w-full items-center gap-2 rounded-sm px-2 text-[13px] transition-colors hover:bg-surface-2"
          >
            <span className="flex h-3.5 w-3.5 items-center justify-center">
              {entry.status === value ? (
                <Check size={12} strokeWidth={2} className="text-primary" />
              ) : (
                <span className={cn('h-2 w-2 rounded-full border', STATUS_TONE[value])} aria-hidden />
              )}
            </span>
            <span className="flex-1 text-left">{STATUS_LABEL[value]}</span>
            {ACTIVE_STATUSES.includes(value) ? (
              <span className="text-[10px] text-muted-foreground/60">takipte</span>
            ) : null}
            {index < 5 ? (
              <span className="numeric text-[10px] text-muted-foreground/60">{index + 1}</span>
            ) : null}
          </button>
        ))}
        {entry.status ? (
          <button
            type="button"
            onClick={() => {
              onStatusChange(entry.id, null)
              close()
            }}
            className="flex h-7 w-full items-center gap-2 rounded-sm px-2 text-[12px] text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
          >
            <span className="w-3.5" />
            Durumu kaldır
          </button>
        ) : null}

        <div className="my-1 border-t border-border" />

        <MenuItem
          icon={
            entry.pinned ? <PinOff size={12} strokeWidth={1.5} /> : <Pin size={12} strokeWidth={1.5} />
          }
          label={entry.pinned ? 'Sabitlemeyi kaldır' : 'Takipte yukarı sabitle'}
          onClick={() => {
            onPinToggle(entry.id, !entry.pinned)
            close()
          }}
        />
        <MenuItem
          icon={<Copy size={12} strokeWidth={1.5} />}
          label="id'yi kopyala"
          onClick={() => {
            void navigator.clipboard.writeText(entry.id)
            close()
          }}
        />
        <MenuItem
          icon={<FolderOpen size={12} strokeWidth={1.5} />}
          label="Dosyayı göster"
          onClick={() => {
            void window.devlog.reveal(entry.id)
            close()
          }}
        />
        {onDelete && !entry.readOnly ? (
          <MenuItem
            icon={<Trash2 size={12} strokeWidth={1.5} />}
            label="Sil"
            danger
            onClick={() => {
              onDelete(entry.id)
              close()
            }}
          />
        ) : null}
      </Popover>
    </>
  )
}

function MenuItem({
  icon,
  label,
  onClick,
  danger,
}: {
  icon: ReactNode
  label: string
  onClick: () => void
  danger?: boolean
}): ReactNode {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex h-7 w-full items-center gap-2 rounded-sm px-2 text-[12px] transition-colors hover:bg-surface-2',
        danger ? 'text-destructive' : 'text-foreground',
      )}
    >
      <span className="flex h-3.5 w-3.5 items-center justify-center text-muted-foreground">
        {icon}
      </span>
      {label}
    </button>
  )
}
