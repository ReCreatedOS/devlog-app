import { useMemo, type ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { mapOutsideCode } from '@devlog/core/shared'
import { cn } from '../lib/cn'

const WIKILINK_RE = /\[\[([^\]|]+?)(?:\|([^\]]*))?\]\]/g
const INTERNAL_PREFIX = 'devlog:'

/**
 * `[[hedef]]` → normal markdown bağlantısı; işleme react-markdown'a kalır.
 * `mapOutsideCode` sayesinde kod bloklarına ve satır içi koda dokunulmaz —
 * yoksa backtick içine yazılmış bir wikilink, kod olarak `[x](devlog:x)`
 * biçiminde ham görünürdü.
 */
function preprocess(markdown: string): string {
  return mapOutsideCode(markdown, (chunk) =>
    chunk.replace(WIKILINK_RE, (_match, target: string, label?: string) => {
      const text = (label ?? target).trim()
      return `[${text}](${INTERNAL_PREFIX}${encodeURIComponent(target.trim())})`
    }),
  )
}

interface MarkdownProps {
  children: string
  /** `[[link]]` hedefinin karşılığı var mı — yoksa kesikli/uyarı rengiyle çizilir. */
  resolved?: Record<string, boolean>
  onOpenEntry?: (id: string) => void
}

export function Markdown({ children, resolved, onOpenEntry }: MarkdownProps): ReactNode {
  const source = useMemo(() => preprocess(children), [children])

  return (
    <div
      className={cn(
        'selectable text-[13px] leading-[1.65] text-foreground/90',
        '[&_p]:my-2.5 [&_ul]:my-2.5 [&_ol]:my-2.5 [&_ul]:list-disc [&_ol]:list-decimal [&_ul]:pl-5 [&_ol]:pl-5',
        '[&_li]:my-0.5',
        '[&_h1]:mt-5 [&_h1]:mb-2 [&_h1]:text-[17px] [&_h1]:font-semibold',
        '[&_h2]:mt-5 [&_h2]:mb-2 [&_h2]:text-[15px] [&_h2]:font-semibold',
        '[&_h3]:mt-4 [&_h3]:mb-1.5 [&_h3]:text-[14px] [&_h3]:font-semibold',
        '[&_strong]:font-semibold [&_strong]:text-foreground',
        '[&_code]:rounded-2xs [&_code]:bg-surface-2 [&_code]:px-1 [&_code]:py-px [&_code]:font-mono [&_code]:text-[12px]',
        '[&_pre]:my-3 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:border [&_pre]:border-border [&_pre]:bg-surface-1 [&_pre]:p-3',
        '[&_pre_code]:bg-transparent [&_pre_code]:p-0',
        '[&_blockquote]:my-3 [&_blockquote]:border-l-2 [&_blockquote]:border-border-strong [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground',
        '[&_hr]:my-4 [&_hr]:border-border',
        '[&_table]:my-3 [&_table]:w-full [&_table]:text-[12px]',
        '[&_th]:border [&_th]:border-border [&_th]:bg-surface-1 [&_th]:px-2 [&_th]:py-1 [&_th]:text-left',
        '[&_td]:border [&_td]:border-border [&_td]:px-2 [&_td]:py-1 [&_td]:align-top',
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children: label }) => {
            if (href?.startsWith(INTERNAL_PREFIX)) {
              const target = decodeURIComponent(href.slice(INTERNAL_PREFIX.length))
              const exists = resolved?.[target]
              return (
                <button
                  type="button"
                  onClick={() => onOpenEntry?.(target)}
                  title={exists === false ? 'Bu kayıt henüz yok' : target}
                  className={cn(
                    'rounded-2xs px-0.5 underline decoration-1 underline-offset-2 transition-colors',
                    exists === false
                      ? 'text-warning decoration-dashed hover:bg-warning/10'
                      : 'text-primary hover:bg-primary/10',
                  )}
                >
                  {label}
                </button>
              )
            }
            return (
              <button
                type="button"
                onClick={() => {
                  if (href) void window.devlog.openExternal(href)
                }}
                className="text-primary underline decoration-1 underline-offset-2"
              >
                {label}
              </button>
            )
          },
        }}
      >
        {source}
      </ReactMarkdown>
    </div>
  )
}
