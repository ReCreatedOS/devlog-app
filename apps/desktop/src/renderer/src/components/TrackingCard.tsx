import { useEffect, useRef, useState, type ReactNode } from 'react'
import { STATUS_LABEL, isActiveStatus, trackingState } from '@devlog/core/shared'
import type { Entry, TrackingPatch } from '@devlog/core/shared'
import { AlarmClock, CalendarClock, CornerDownRight, Hourglass, Pin, PinOff } from 'lucide-react'
import { cn } from '../lib/cn'
import { IconButton } from './primitives'
import { StatusMenu } from './StatusMenu'

interface TrackingCardProps {
  entry: Entry
  onTrack: (patch: TrackingPatch) => void
}

/**
 * Detay panelinin şimdiki-zaman bölümü.
 *
 * Kaydın gövdesi olayı anlatır; burası konunun bugünkü hâlini tutar ve düzenleme
 * moduna girmeden değiştirilebilir. Ayna kayıtlarında da çalışır — değişiklik
 * kaynağa değil, defterdeki takip dosyasına yazılır.
 */
export function TrackingCard({ entry, onTrack }: TrackingCardProps): ReactNode {
  const state = trackingState(entry)
  const derived = entry.derived?.includes('status')
  const active = isActiveStatus(entry.status)

  return (
    <div className="mb-3 rounded-md border border-border bg-surface-1 px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <StatusMenu
          status={entry.status}
          derived={derived}
          mirrored={entry.readOnly}
          onChange={(next) => onTrack({ status: next })}
        />

        {entry.status ? (
          <span
            className={cn(
              'inline-flex items-center gap-1 text-[11px] text-muted-foreground',
              state.stale && 'text-warning',
            )}
            title={
              (entry.status_since
                ? 'Durumun değiştiği andan beri'
                : 'Olayın tarihinden beri (durum elle ayarlanmadı)') +
              (Number.isFinite(state.thresholdDays)
                ? ` · bayatlık eşiği ${state.thresholdDays} gün`
                : '')
            }
          >
            <Hourglass size={11} strokeWidth={1.5} />
            <span className="numeric">{state.ageDays} gün</span>
            {active ? ` · ${STATUS_LABEL[entry.status].toLocaleLowerCase('tr')}` : null}
            {state.stale ? ' · bayat' : null}
          </span>
        ) : null}

        <div className="ml-auto flex items-center gap-0.5">
          <IconButton
            onClick={() => onTrack({ pinned: !entry.pinned })}
            active={entry.pinned}
            title={entry.pinned ? 'Sabitlemeyi kaldır' : 'Takip listesinde yukarı sabitle'}
          >
            {entry.pinned ? (
              <Pin size={13} strokeWidth={1.5} />
            ) : (
              <PinOff size={13} strokeWidth={1.5} />
            )}
          </IconButton>
        </div>
      </div>

      <InlineField
        icon={<CornerDownRight size={11} strokeWidth={1.5} />}
        value={entry.next_action ?? ''}
        placeholder="Sıradaki adım…"
        onCommit={(value) => onTrack({ next_action: value || null })}
      />

      <div className="mt-1.5 flex items-center gap-2 text-[11px]">
        <CalendarClock size={11} strokeWidth={1.5} className="shrink-0 text-muted-foreground" />
        <span className="text-muted-foreground">Gözden geçir</span>
        <ReviewDateField
          value={entry.next_review ?? ''}
          onCommit={(next) => onTrack({ next_review: next || null })}
        />
        {state.reviewDue ? (
          <span className="inline-flex items-center gap-1 text-warning">
            <AlarmClock size={11} strokeWidth={1.5} />
            zamanı geldi
          </span>
        ) : null}
      </div>

      {entry.tracking_note ? (
        <div className="mt-2 border-t border-border pt-2 text-[12px] leading-snug text-foreground/85">
          <div className="mb-0.5 text-[10px] font-semibold tracking-[0.04em] text-muted-foreground uppercase">
            Takip notu
          </div>
          {entry.tracking_note}
        </div>
      ) : null}
    </div>
  )
}

interface InlineFieldProps {
  icon: ReactNode
  value: string
  placeholder: string
  onCommit: (value: string) => void
}

/**
 * Yerinde düzenlenen tek satır. Enter ya da odak kaybında yazar, Esc iptal eder —
 * ayrı bir "kaydet" düğmesi bu kadar küçük bir alan için sürtünme olurdu.
 */
function InlineField({ icon, value, placeholder, onCommit }: InlineFieldProps): ReactNode {
  const [draft, setDraft] = useState(value)
  const dirty = useRef(false)

  useEffect(() => {
    setDraft(value)
    dirty.current = false
  }, [value])

  const commit = (): void => {
    if (!dirty.current) return
    dirty.current = false
    if (draft.trim() !== value.trim()) onCommit(draft.trim())
  }

  return (
    <div className="mt-2 flex items-center gap-1.5">
      <span className="shrink-0 text-muted-foreground">{icon}</span>
      <input
        value={draft}
        placeholder={placeholder}
        onChange={(event) => {
          dirty.current = true
          setDraft(event.target.value)
        }}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            commit()
            event.currentTarget.blur()
          }
          if (event.key === 'Escape') {
            event.stopPropagation()
            setDraft(value)
            dirty.current = false
            event.currentTarget.blur()
          }
        }}
        className={cn(
          'h-6 w-full rounded-2xs border border-transparent bg-transparent px-1 text-[12px]',
          'placeholder:text-muted-foreground/60 hover:border-border',
          'focus:border-border-strong focus:bg-surface-2 focus:outline-none',
        )}
      />
    </div>
  )
}

/**
 * Gözden geçirme tarihi.
 *
 * `type="date"` her tuş vuruşunda `change` yayıyor: kullanıcı yılı yazarken
 * "2" bastığı anda tarih `0002-08-23` olarak KAYDEDİLİYOR ve kayıt anında
 * "zamanı geldi" işaretleniyordu. Bu yüzden taslak yerel tutuluyor ve yalnız
 * makul bir tarih olduğunda yazılıyor.
 */
function ReviewDateField({
  value,
  onCommit,
}: {
  value: string
  onCommit: (next: string) => void
}): ReactNode {
  const [draft, setDraft] = useState(value)

  useEffect(() => {
    setDraft(value)
  }, [value])

  const commit = (next: string): void => {
    if (next === '') {
      if (value !== '') onCommit('')
      return
    }
    const year = Number(next.slice(0, 4))
    // Yıl dört haneli ve bu yüzyıla makul yakınsa kabul; değilse kullanıcı
    // hâlâ yazıyor demektir.
    if (!Number.isFinite(year) || year < 2000 || year > 2100) return
    if (next !== value) onCommit(next)
  }

  return (
    <input
      type="date"
      value={draft}
      onChange={(event) => {
        setDraft(event.target.value)
        commit(event.target.value)
      }}
      onBlur={() => setDraft(value)}
      className="numeric h-6 rounded-2xs border border-border bg-surface-2 px-1.5 text-[11px] text-foreground focus:border-border-strong focus:outline-none"
    />
  )
}
