import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '../lib/cn'

/**
 * Çapalanmış açılır katman — `document.body`'ye portal ile çizilir.
 *
 * Neden portal: menüler liste satırlarının içinde duruyor ve liste
 * sanallaştırılmış bir `overflow-y-auto` kabı. Kabın içinde `absolute` konumlanan
 * bir menü kabın kenarında KIRPILIR; alttaki satırlarda menünün yarısı, sağdaki
 * sütunlarda kenarı kesiliyordu. Portal + `position: fixed` bu sınıfı tümden
 * ortadan kaldırır (yığılma bağlamı sorunları da dâhil).
 *
 * Kaydırmada kapanır: açık bir menüyü çapasıyla birlikte sürüklemek yerine
 * kapatmak hem daha ucuz hem daha az şaşırtıcı.
 */
export interface PopoverProps {
  open: boolean
  anchorRef: RefObject<HTMLElement | null>
  onClose: () => void
  children: ReactNode
  /** Çapanın hangi kenarına hizalansın. */
  align?: 'left' | 'right'
  className?: string
}

const GAP = 6
const MARGIN = 8

export function Popover({
  open,
  anchorRef,
  onClose,
  children,
  align = 'right',
  className,
}: PopoverProps): ReactNode {
  const panelRef = useRef<HTMLDivElement | null>(null)
  const [style, setStyle] = useState<{ top: number; left: number; maxHeight: number } | null>(null)

  // Ölçüm boyamadan önce yapılır: menü önce yanlış yerde görünüp sonra
  // zıplamasın.
  useLayoutEffect(() => {
    if (!open) {
      setStyle(null)
      return
    }
    const anchor = anchorRef.current
    const panel = panelRef.current
    if (!anchor || !panel) return

    const rect = anchor.getBoundingClientRect()
    const { width, height } = panel.getBoundingClientRect()
    const spaceBelow = window.innerHeight - rect.bottom - GAP - MARGIN
    const spaceAbove = rect.top - GAP - MARGIN
    const flip = spaceBelow < Math.min(height, 200) && spaceAbove > spaceBelow

    const top = flip
      ? Math.max(MARGIN, rect.top - GAP - Math.min(height, spaceAbove))
      : rect.bottom + GAP
    const rawLeft = align === 'right' ? rect.right - width : rect.left
    const left = Math.min(Math.max(MARGIN, rawLeft), window.innerWidth - width - MARGIN)

    setStyle({ top, left, maxHeight: Math.max(160, flip ? spaceAbove : spaceBelow) })
  }, [open, anchorRef, align])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: MouseEvent): void => {
      const target = event.target as Node
      if (panelRef.current?.contains(target) || anchorRef.current?.contains(target)) return
      onClose()
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
      }
    }
    // `true`: kaydırma olayı iç kaplardan geliyor, balonlaşmıyor.
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKey, true)
    window.addEventListener('scroll', onClose, true)
    window.addEventListener('resize', onClose)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKey, true)
      window.removeEventListener('scroll', onClose, true)
      window.removeEventListener('resize', onClose)
    }
  }, [open, onClose, anchorRef])

  if (!open) return null

  return createPortal(
    <div
      ref={panelRef}
      // Ölçüm turunda görünmez: yanlış konumda tek kare bile parlamasın.
      style={{
        position: 'fixed',
        top: style?.top ?? -9999,
        left: style?.left ?? -9999,
        maxHeight: style?.maxHeight,
        visibility: style ? 'visible' : 'hidden',
      }}
      className={cn(
        'z-[100] overflow-y-auto rounded-xl border border-border bg-popover p-1',
        'shadow-[var(--shadow-panel)]',
        className,
      )}
      onClick={(event) => event.stopPropagation()}
    >
      {children}
    </div>,
    document.body,
  )
}
