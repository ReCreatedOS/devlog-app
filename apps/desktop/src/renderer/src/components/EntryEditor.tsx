import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { markdown } from '@codemirror/lang-markdown'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { EditorView } from '@codemirror/view'
import { tags } from '@lezer/highlight'
import CodeMirror from '@uiw/react-codemirror'
import {
  ENTRY_TYPES,
  SEVERITIES,
  SEVERITY_LABEL,
  SEVERITY_REQUIRED_TYPES,
  TYPE_META,
} from '@devlog/core/shared'
import type { Entry, EntryFrontmatter, EntryType, Severity } from '@devlog/core/shared'
import { cn } from '../lib/cn'

/**
 * Düzenleme ayrı bir EKRAN değildir: detay panelinin aynı yerleşimi içinde
 * alanlar yazılabilir hâle gelir. Bu yüzden burada tek parça bir "editör"
 * yok — detay panelinin kendi düzenine oturan parçalar var.
 *
 * Gerekçe: kaleme basınca okuduğun sayfanın yok olup yerine bir form gelmesi,
 * "neredeydim" sorusunu her seferinde yeniden sordurtuyordu.
 */

/**
 * CodeMirror'ı uygulamanın token'larına bağlar — ayrı bir tema paketi taşımıyoruz.
 *
 * Seçim rengi burada, CSS dosyasında DEĞİL: CodeMirror kurallarını katmansız
 * (`@layer` dışı) enjekte ediyor ve Tailwind'in `@layer base`'i normal
 * bildirimlerde katmansıza her zaman yenilir. Yani app.css'ten ezmeye çalışmak
 * sessizce etkisiz kalır.
 */
const SELECTION_BG = 'color-mix(in srgb, var(--primary) 30%, var(--background))'

const editorTheme = EditorView.theme({
  '&': {
    backgroundColor: 'transparent',
    color: 'var(--foreground)',
    fontSize: '13px',
    minHeight: '12rem',
  },
  '.cm-content': {
    fontFamily: 'var(--font-sans)',
    lineHeight: '1.7',
    padding: '0',
  },
  '.cm-line': { padding: '0' },
  '&.cm-focused': { outline: 'none' },
  // Native caret'i drawSelection `caret-color: transparent !important` ile
  // kapatıyor; görünen imleç bu iki eleman.
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--primary)' },
  '.cm-gutters': { display: 'none' },
  '.cm-activeLine': { backgroundColor: 'transparent' },
  '.cm-scroller': { overflow: 'visible', fontFamily: 'var(--font-sans)' },

  // ——— SEÇİM ———
  // Editöre `dark: true` demediğimiz için CodeMirror kendini AÇIK temada sanıp
  // base theme'inden `#d7d4f0` seçim bandı basıyordu; koyu temada `#f7f8f8`
  // metinle kontrast 1.36:1 — yani seçilen yazı okunmuyordu.
  //
  // Ezmek için base'in seçici ŞEKLİNİ birebir kullanmak gerekiyor: base kural
  // (0,5,0) özgüllükte ve daha kısa bir seçici ne yazarsak yazsın kaybeder.
  // Metin rengi vermiyoruz — seçim, metnin ALTINA çizilen boş div'lerdir,
  // içlerinde metin yok.
  '.cm-selectionLayer .cm-selectionBackground': { background: SELECTION_BG },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground': {
    background: SELECTION_BG,
  },
})

/**
 * Markdown vurgusu. CodeMirror'ın varsayılanı açık zemin için ayarlı (`#708`,
 * `#a11`, `#219`) ve koyu temada okunmuyordu; burada uygulamanın kendi
 * token'larını kullanıyoruz, böylece iki temada da doğru.
 */
const highlight = HighlightStyle.define([
  { tag: tags.heading, color: 'var(--foreground)', fontWeight: '600' },
  { tag: tags.strong, color: 'var(--foreground)', fontWeight: '600' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.link, color: 'var(--primary)' },
  { tag: tags.url, color: 'var(--primary)', textDecoration: 'underline' },
  { tag: tags.monospace, color: 'var(--info)', fontFamily: 'var(--font-mono)' },
  { tag: tags.quote, color: 'var(--muted-foreground)' },
  { tag: tags.list, color: 'var(--primary)' },
  { tag: tags.strikethrough, textDecoration: 'line-through' },
  { tag: tags.processingInstruction, color: 'var(--muted-foreground)' },
])

export interface EntryDraft {
  title: string
  type: EntryType
  severity: Severity | ''
  area: string
  tags: string
  body: string
}

export interface DraftHandle {
  draft: EntryDraft
  set: <K extends keyof EntryDraft>(key: K, value: EntryDraft[K]) => void
  /** Kaydedilmemiş değişiklik var mı — alt çubuk ve çıkış uyarısı bunu kullanır. */
  dirty: boolean
  canSave: boolean
  severityRequired: boolean
  build: () => { frontmatter: EntryFrontmatter; body: string }
  reset: () => void
}

function toDraft(entry: Entry): EntryDraft {
  return {
    title: entry.title,
    type: entry.type,
    severity: entry.severity ?? '',
    area: entry.area ?? '',
    tags: (entry.tags ?? []).join(', '),
    body: entry.body,
  }
}

export function useEntryDraft(entry: Entry): DraftHandle {
  const [draft, setDraft] = useState<EntryDraft>(() => toDraft(entry))
  const original = useMemo(() => toDraft(entry), [entry.id, entry.updated_at])

  // Başka bir kayda geçildiğinde ya da dosya diskte değiştiğinde formu tazele.
  useEffect(() => {
    setDraft(original)
  }, [original])

  const dirty = useMemo(
    () => (Object.keys(draft) as Array<keyof EntryDraft>).some((k) => draft[k] !== original[k]),
    [draft, original],
  )

  const severityRequired = SEVERITY_REQUIRED_TYPES.includes(draft.type)

  return {
    draft,
    dirty,
    severityRequired,
    canSave: draft.title.trim().length > 0 && (!severityRequired || draft.severity !== ''),
    set: (key, value) => setDraft((prev) => ({ ...prev, [key]: value })),
    reset: () => setDraft(original),
    build: () => ({
      frontmatter: {
        ...entry,
        title: draft.title.trim(),
        type: draft.type,
        severity: draft.severity === '' ? undefined : draft.severity,
        area: draft.area.trim() || undefined,
        tags: draft.tags
          .split(',')
          .map((t) => t.trim().toLowerCase())
          .filter(Boolean),
      },
      body: draft.body,
    }),
  }
}

/**
 * Başlık alanı. `input` değil `textarea`: uzun başlıklar tek satıra sıkışıp
 * yatay kayıyordu — okunmayan bir başlık düzenlenemez de.
 */
export function TitleField({
  value,
  onChange,
}: {
  value: string
  onChange: (next: string) => void
}): ReactNode {
  const ref = useRef<HTMLTextAreaElement | null>(null)

  useLayoutEffect(() => {
    const node = ref.current
    if (!node) return
    node.style.height = 'auto'
    node.style.height = `${node.scrollHeight}px`
  }, [value])

  useEffect(() => {
    const node = ref.current
    if (!node) return
    node.focus()
    node.setSelectionRange(node.value.length, node.value.length)
    // Yalnız düzenleme açılırken odaklanır; her tuşta imleci sona atmasın diye
    // bağımlılık listesi kasıtlı olarak boş.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- tek seferlik odak
  }, [])

  return (
    <textarea
      ref={ref}
      value={value}
      rows={1}
      spellCheck={false}
      onChange={(event) => onChange(event.target.value)}
      placeholder="Başlık"
      className={cn(
        'w-full resize-none overflow-hidden rounded-2xs bg-transparent',
        'text-[15px] leading-snug font-semibold text-foreground',
        'placeholder:text-muted-foreground/60 focus:outline-none',
      )}
    />
  )
}

const fieldClass = cn(
  'h-7 w-full rounded-xs border border-border bg-surface-1 px-1.5 text-[12px] text-foreground',
  'focus:border-border-strong focus:outline-none',
)

function Field({ label, children }: { label: string; children: ReactNode }): ReactNode {
  return (
    <label className="flex min-w-0 flex-col gap-1">
      <span className="text-[10px] font-semibold tracking-[0.04em] text-muted-foreground uppercase">
        {label}
      </span>
      {children}
    </label>
  )
}

/** Tür / severity / alan / etiket — DURUM burada yok, o takip kartında yaşıyor. */
export function MetaFields({ handle }: { handle: DraftHandle }): ReactNode {
  const { draft, set, severityRequired } = handle
  return (
    <div className="grid grid-cols-2 gap-2">
      <Field label="Tür">
        <select
          value={draft.type}
          onChange={(event) => set('type', event.target.value as EntryType)}
          className={fieldClass}
        >
          {ENTRY_TYPES.map((value) => (
            <option key={value} value={value}>
              {TYPE_META[value].label}
            </option>
          ))}
        </select>
      </Field>

      <Field label={severityRequired ? 'Severity (zorunlu)' : 'Severity'}>
        <select
          value={draft.severity}
          onChange={(event) => set('severity', event.target.value as Severity | '')}
          className={cn(
            fieldClass,
            severityRequired && draft.severity === '' && 'border-destructive',
          )}
        >
          <option value="">—</option>
          {SEVERITIES.map((value) => (
            <option key={value} value={value}>
              {SEVERITY_LABEL[value]}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Alan">
        <input
          value={draft.area}
          onChange={(event) => set('area', event.target.value)}
          placeholder="cdn, auth, billing…"
          className={fieldClass}
        />
      </Field>

      <Field label="Etiketler (virgülle)">
        <input
          value={draft.tags}
          onChange={(event) => set('tags', event.target.value)}
          placeholder="api, auth, perf"
          className={fieldClass}
        />
      </Field>
    </div>
  )
}

/**
 * Gövde editörü. Markdown önizlemesiyle AYNI kutuda, aynı genişlikte akar:
 * düzenlemeye geçmek metnin yerini değiştirmemeli, yalnız yazılabilir yapmalı.
 * Bu yüzden editörün kendi kaydırma alanı yok (`overflow: visible`) — panelin
 * kaydırması sürer.
 */
export function BodyEditor({
  value,
  onChange,
}: {
  value: string
  onChange: (next: string) => void
}): ReactNode {
  const extensions = useMemo(
    () => [markdown(), editorTheme, syntaxHighlighting(highlight), EditorView.lineWrapping],
    [],
  )
  return (
    <CodeMirror
      value={value}
      onChange={onChange}
      extensions={extensions}
      // Verilmezse @uiw varsayılan olarak 'light' temayı ekliyor
      // (`{'&': {backgroundColor: '#fff'}}`) ve CM6'da ÖNCE gelen extension
      // kazandığı için bizim `transparent`'ımızı eziyor: koyu temada bembeyaz
      // bir editör kutusu ve onun üstünde okunmayan seçim.
      theme="none"
      basicSetup={{
        lineNumbers: false,
        foldGutter: false,
        highlightActiveLine: false,
        highlightActiveLineGutter: false,
        autocompletion: false,
        searchKeymap: false,
      }}
      height="auto"
      className="cm-inline"
    />
  )
}
