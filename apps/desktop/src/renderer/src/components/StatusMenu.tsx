import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { ACTIVE_STATUSES, STATUSES, STATUS_LABEL } from '@devlog/core/shared'
import type { EntryStatus } from '@devlog/core/shared'
import { Check, ChevronDown, Lock } from 'lucide-react'
import { cn } from '../lib/cn'
import { STATUS_TONE } from '../lib/format'
import { Popover } from './Popover'

interface StatusMenuProps {
  status?: EntryStatus
  /** Salt-okunur ayna: değişiklik vault'taki takip dosyasına yazılır. */
  mirrored?: boolean
  /** Kaynaktan çıkarılmış tahmin mi (henüz karar verilmemiş). */
  derived?: boolean
  onChange: (next: EntryStatus | null) => void
  /** Küçük hâli: liste satırı ve dar başlıklar için. */
  compact?: boolean
}

/**
 * Durum seçici.
 *
 * Uygulamanın en sık kullanılan eylemi bu olduğu için düzenleme moduna girmeyi
 * gerektirmez: hap doğrudan düğmedir. Salt-okunur aynadaki kayıtlarda da
 * çalışır — orada değişiklik kaynağa değil, vault'taki takip dosyasına gider.
 */
export function StatusMenu({
  status,
  mirrored,
  derived,
  onChange,
  compact,
}: StatusMenuProps): ReactNode {
  const [open, setOpen] = useState(false)
  const anchorRef = useRef<HTMLButtonElement | null>(null)
  const close = useCallback(() => setOpen(false), [])

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent): void => {
      // Menü açıkken 1–8 doğrudan seçer; kapalıyken aynı tuşlar listede çalışır.
      const index = Number(event.key)
      if (Number.isInteger(index) && index >= 1 && index <= STATUSES.length) {
        event.preventDefault()
        event.stopPropagation()
        const next = STATUSES[index - 1]
        if (next) {
          onChange(next)
          setOpen(false)
        }
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [open, onChange])

  return (
    <>
      <button
        ref={anchorRef}
        // `key`: durum değişince düğme yeniden bağlanır ve flaş animasyonu
        // kendiliğinden oynar — ayrıca bir "az önce değişti" durumu taşımaya
        // gerek kalmaz.
        key={status ?? 'yok'}
        type="button"
        onClick={(event) => {
          event.stopPropagation()
          setOpen((v) => !v)
        }}
        title={
          status
            ? `Durum: ${STATUS_LABEL[status]}${derived ? ' (kaynaktan çıkarıldı)' : ''}`
            : 'Durum ata'
        }
        className={cn(
          'commit-flash hit inline-flex shrink-0 items-center gap-1 rounded-2xs border text-[10px] font-medium',
          compact ? 'h-[19px] gap-1.5 px-1.5' : 'h-[23px] gap-1.5 px-2',
          status ? STATUS_TONE[status] : 'border-dashed border-border text-muted-foreground',
          derived && 'border-dashed',
          'hover:brightness-110',
        )}
      >
        <span
          aria-hidden
          className={cn(
            'h-1.5 w-1.5 shrink-0 rounded-full',
            status ? 'bg-current opacity-80' : 'border border-current opacity-50',
          )}
        />
        {status ? STATUS_LABEL[status] : 'durum yok'}
        {derived ? <span className="opacity-70">*</span> : null}
        <ChevronDown size={10} strokeWidth={1.75} className="-mr-0.5 opacity-50" />
      </button>

      <Popover open={open} anchorRef={anchorRef} onClose={close} align={compact ? 'right' : 'left'} className="min-w-52">
        {STATUSES.map((value, index) => (
          <button
            key={value}
            type="button"
            onClick={(event) => {
              event.stopPropagation()
              onChange(value)
              setOpen(false)
            }}
            className="flex h-7 w-full items-center gap-2 rounded-sm px-2 text-[13px] transition-colors hover:bg-surface-2"
          >
            <span className="flex h-3.5 w-3.5 items-center justify-center">
              {status === value ? (
                <Check size={12} strokeWidth={2} className="text-primary" />
              ) : null}
            </span>
            <span className="flex-1 text-left">{STATUS_LABEL[value]}</span>
            {ACTIVE_STATUSES.includes(value) ? (
              <span className="text-[10px] text-muted-foreground/60">takipte</span>
            ) : null}
            <span className="numeric text-[10px] text-muted-foreground/60">{index + 1}</span>
          </button>
        ))}

        {status ? (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation()
              onChange(null)
              setOpen(false)
            }}
            className="mt-1 flex h-7 w-full items-center gap-2 rounded-sm border-t border-border px-2 pt-1 text-[12px] text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
          >
            Durumu kaldır
          </button>
        ) : null}

        {mirrored ? (
          <div className="mt-1 flex items-start gap-1.5 border-t border-border px-2 pt-1.5 pb-1 text-[10px] leading-snug text-muted-foreground">
            <Lock size={10} strokeWidth={1.5} className="mt-px shrink-0" />
            <span>Bu kayıt bir ayna. Durum defterinde tutulur, kaynak dosyaya yazılmaz.</span>
          </div>
        ) : null}
      </Popover>
    </>
  )
}
