import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { SEVERITY_LABEL, TYPE_META, parseCapture } from '@devlog/core/shared'
import { cn } from '../lib/cn'
import { Kbd } from './primitives'

interface CaptureComposerProps {
  /** `true` → kaydet ve ana pencerede aç. */
  onSubmit: (text: string, openMain: boolean) => void | Promise<void>
  onClose: () => void
  /** Yükseklik değiştikçe pencereyi büyütmek için (yalnız yakalama penceresi). */
  onHeightChange?: (height: number) => void
  placeholder?: string
  busy?: boolean
  error?: string | null
}

/**
 * Hızlı yakalama düzenleyicisi. Hem global kısayolla açılan küçük pencere hem de
 * ana penceredeki "yeni kayıt" kutusu bunu kullanır — tek satır-içi komut dili,
 * tek kas hafızası.
 */
export function CaptureComposer({
  onSubmit,
  onClose,
  onHeightChange,
  placeholder = 'Ne oldu? …',
  busy,
  error,
}: CaptureComposerProps): ReactNode {
  const [text, setText] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const cardRef = useRef<HTMLDivElement | null>(null)

  const parsed = useMemo(() => parseCapture(text), [text])

  useEffect(() => {
    textareaRef.current?.focus()
  }, [])

  // Metin büyüdükçe textarea ve (varsa) pencere birlikte büyür.
  useEffect(() => {
    const textarea = textareaRef.current
    if (!textarea) return
    textarea.style.height = 'auto'
    textarea.style.height = `${Math.min(textarea.scrollHeight, 260)}px`
    if (onHeightChange && cardRef.current) {
      onHeightChange(cardRef.current.getBoundingClientRect().height + 24)
    }
  }, [text, onHeightChange, error])

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
      return
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      if (!text.trim() || busy) return
      void onSubmit(text, event.metaKey || event.ctrlKey)
      setText('')
    }
  }

  return (
    <div
      ref={cardRef}
      className="overflow-hidden rounded-2xl border border-border-strong bg-popover shadow-[var(--shadow-panel)]"
    >
      <textarea
        ref={textareaRef}
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        spellCheck={false}
        rows={1}
        className={cn(
          'block w-full resize-none bg-transparent px-4 pt-3.5 pb-2 text-[15px] leading-relaxed',
          'placeholder:text-muted-foreground/60 focus:outline-none',
        )}
      />

      {error ? (
        <div className="border-t border-destructive/30 bg-destructive/10 px-4 py-1.5 text-[11px] text-destructive">
          {error}
        </div>
      ) : null}

      <div className="flex items-center gap-1.5 border-t border-border px-3 py-2 text-[11px]">
        <span className="rounded-2xs bg-surface-2 px-1.5 py-0.5 font-medium text-foreground">
          {TYPE_META[parsed.type].label}
          {parsed.explicitType ? '' : ' (varsayılan)'}
        </span>
        {parsed.severity ? (
          <span className="rounded-2xs bg-surface-2 px-1.5 py-0.5 text-muted-foreground">
            {SEVERITY_LABEL[parsed.severity]}
          </span>
        ) : null}
        {parsed.area ? (
          <span className="rounded-2xs bg-surface-2 px-1.5 py-0.5 text-muted-foreground">
            @{parsed.area}
          </span>
        ) : null}
        {parsed.tags.map((tag) => (
          <span key={tag} className="rounded-2xs bg-surface-2 px-1.5 py-0.5 text-muted-foreground">
            #{tag}
          </span>
        ))}

        <span className="ml-auto flex items-center gap-1 text-muted-foreground">
          <Kbd>↵</Kbd> kaydet
          <span className="opacity-50">·</span>
          <Kbd>⇧↵</Kbd> satır
          <span className="opacity-50">·</span>
          <span title="/tür  !severity  @alan  #etiket">/tür !sev @alan #etiket</span>
        </span>
      </div>
    </div>
  )
}
