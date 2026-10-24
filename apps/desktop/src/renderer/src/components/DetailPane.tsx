import { useEffect, useState, type ReactNode } from 'react'
import { SEVERITY_LABEL, TYPE_META } from '@devlog/core/shared'
import type { Entry, TrackingPatch } from '@devlog/core/shared'
import {
  AlertTriangle,
  ArrowUpRight,
  CornerDownRight,
  FileText,
  FolderOpen,
  Lock,
  Pencil,
  Trash2,
  Users,
  X,
} from 'lucide-react'
import { cn } from '../lib/cn'
import { absoluteDateTime, relativeTime, SEVERITY_TEXT, timeOfDay } from '../lib/format'
import type { EntryDetail } from '../../../shared/ipc.js'
import { SeverityDot, TagChip } from './badges'
import { BodyEditor, MetaFields, TitleField, useEntryDraft } from './EntryEditor'
import { Markdown } from './Markdown'
import { Button, EmptyState, IconButton, Kbd } from './primitives'
import { TrackingCard } from './TrackingCard'

interface DetailPaneProps {
  detail: EntryDetail | null
  editing: boolean
  onEdit: () => void
  onCancelEdit: () => void
  onOpenEntry: (id: string) => void
  onTagClick: (tag: string) => void
  onDelete: (id: string) => void
  onSaved: () => void
  /** Takip alanlarını değiştirir — ayna kayıtlarında da çalışır. */
  onTrack: (id: string, patch: TrackingPatch) => void
}

function MetaRow({ label, children }: { label: string; children: ReactNode }): ReactNode {
  return (
    <div className="flex gap-2 py-0.5 text-[12px]">
      <span className="w-20 shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 flex-1 text-foreground/85">{children}</span>
    </div>
  )
}

export function DetailPane(props: DetailPaneProps): ReactNode {
  const entry = props.detail?.entry ?? null
  if (!entry) {
    return (
      <EmptyState
        icon={<FileText size={28} strokeWidth={1.2} />}
        title="Kayıt seçilmedi"
        hint={
          <span className="inline-flex flex-wrap items-center justify-center gap-1">
            Listeden bir satır seç ya da <Kbd>⌘N</Kbd> ile yeni kayıt aç.
          </span>
        }
      />
    )
  }
  // `key`: kayıt değişince taslak durumu sıfırdan kurulsun.
  return <EntryDetail key={entry.id} {...props} entry={entry} />
}

function EntryDetail({
  entry,
  detail,
  editing,
  onEdit,
  onCancelEdit,
  onOpenEntry,
  onTagClick,
  onDelete,
  onSaved,
  onTrack,
}: DetailPaneProps & { entry: Entry }): ReactNode {
  const [resolved, setResolved] = useState<Record<string, boolean>>({})
  const [conflict, setConflict] = useState<Entry | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const handle = useEntryDraft(entry)

  // `[[link]]` hedeflerinin var olup olmadığını tek turda çöz.
  useEffect(() => {
    const links = entry.outboundLinks ?? []
    if (links.length === 0) {
      setResolved({})
      return
    }
    let cancelled = false
    void window.devlog.resolve(links).then((map) => {
      if (!cancelled) setResolved(map)
    })
    return () => {
      cancelled = true
    }
  }, [entry.id, entry.outboundLinks])

  useEffect(() => {
    setConflict(null)
    setError(null)
    setConfirmDiscard(false)
  }, [editing])

  const save = async (): Promise<void> => {
    if (!handle.canSave) return
    const { frontmatter, body } = handle.build()
    const outcome = await window.devlog.save(entry.id, frontmatter, body, entry.updated_at)
    if (outcome.ok) {
      onSaved()
      return
    }
    if (outcome.reason === 'conflict') setConflict(outcome.current)
    else setError(outcome.message)
  }

  const leaveEdit = (): void => {
    if (handle.dirty) {
      setConfirmDiscard(true)
      return
    }
    onCancelEdit()
  }

  const onKeyDown = (event: React.KeyboardEvent): void => {
    if (!editing) return
    if ((event.metaKey || event.ctrlKey) && (event.key === 's' || event.key === 'Enter')) {
      event.preventDefault()
      void save()
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      leaveEdit()
    }
  }

  const derived = new Set(entry.derived ?? [])
  const backlinks = detail?.backlinks ?? []
  const meta = TYPE_META[entry.type]

  return (
    <div className="flex h-full flex-col overflow-hidden" onKeyDown={onKeyDown}>
      <div className="flex shrink-0 items-start gap-2 border-b border-border px-4 pt-3 pb-3">
        <div className="min-w-0 flex-1">
          {editing ? (
            <TitleField value={handle.draft.title} onChange={(next) => handle.set('title', next)} />
          ) : (
            <h2 className="t-head selectable text-balance text-ink">{entry.title}</h2>
          )}

          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px]">
            <span
              title={meta.description}
              className="font-semibold tracking-[0.04em] text-muted-foreground uppercase"
            >
              {meta.badge}
            </span>
            {entry.severity ? (
              <span
                className={cn(
                  'inline-flex items-center gap-1',
                  SEVERITY_TEXT[entry.severity],
                  derived.has('severity') && 'opacity-80',
                )}
                title={derived.has('severity') ? 'Kaynaktan çıkarıldı' : undefined}
              >
                <SeverityDot severity={entry.severity} />
                {SEVERITY_LABEL[entry.severity]}
                {derived.has('severity') ? '*' : ''}
              </span>
            ) : null}
            <span className="numeric text-muted-foreground">
              {absoluteDateTime(entry.occurred_at)} · {relativeTime(entry.occurred_at)}
            </span>
            {entry.author ? (
              <span
                className="inline-flex items-center gap-1 text-muted-foreground"
                title={
                  entry.readOnly
                    ? 'Takım kaydı — yalnız yazarı düzenler. Durumunu izlemek kişisel takip dosyana yazılır, takıma gitmez.'
                    : 'Takım kaydı — kaydedince ekiple eşitlenir'
                }
              >
                <Users size={11} strokeWidth={1.5} /> @{entry.author}
              </span>
            ) : entry.readOnly ? (
              <span
                className="inline-flex items-center gap-1 text-muted-foreground"
                title="Salt-okunur ayna — kaynağa yazılmaz"
              >
                <Lock size={11} strokeWidth={1.5} /> ayna
              </span>
            ) : null}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-0.5">
          <IconButton onClick={() => void window.devlog.reveal(entry.id)} title="Dosyayı göster">
            <FolderOpen size={14} strokeWidth={1.5} />
          </IconButton>
          {!entry.readOnly ? (
            <>
              <IconButton
                onClick={editing ? leaveEdit : onEdit}
                active={editing}
                title={editing ? 'Düzenlemeyi kapat (Esc)' : 'Düzenle (⌘E)'}
              >
                {editing ? <X size={14} strokeWidth={1.5} /> : <Pencil size={14} strokeWidth={1.5} />}
              </IconButton>
              <IconButton onClick={() => onDelete(entry.id)} title="Sil">
                <Trash2 size={14} strokeWidth={1.5} />
              </IconButton>
            </>
          ) : null}
        </div>
      </div>

      {conflict ? (
        <div className="flex shrink-0 items-start gap-2 border-b border-warning/30 bg-warning/10 px-4 py-2.5">
          <AlertTriangle size={14} strokeWidth={1.5} className="mt-0.5 shrink-0 text-warning" />
          <div className="flex-1 text-[12px]">
            <div className="font-medium text-foreground">Dosya diskte değişti</div>
            <div className="text-muted-foreground">
              Sen düzenlerken bu kayıt başka bir yerden (muhtemelen ajandan) güncellendi.
            </div>
            <div className="mt-1.5 flex gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  handle.reset()
                  setConflict(null)
                  onCancelEdit()
                }}
              >
                Diskteki sürümü yükle
              </Button>
              <Button variant="outline" onClick={() => setConflict(null)}>
                Benimkini koru
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {confirmDiscard ? (
        <div className="flex shrink-0 items-center gap-2 border-b border-warning/30 bg-warning/10 px-4 py-2 text-[12px]">
          <span className="flex-1">Kaydedilmemiş değişiklik var.</span>
          <Button variant="primary" onClick={() => void save()}>
            Kaydet
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              handle.reset()
              setConfirmDiscard(false)
              onCancelEdit()
            }}
          >
            At
          </Button>
        </div>
      ) : null}

      {error ? (
        <div className="shrink-0 border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-[12px] text-destructive">
          {error}
        </div>
      ) : null}

      {derived.size > 0 || (entry.coerced?.length ?? 0) > 0 ? (
        <div className="shrink-0 border-b border-border bg-surface-1 px-4 py-2 text-[11px] text-muted-foreground">
          {derived.size > 0 ? (
            <div>
              Yıldızlı alanlar ({[...derived].join(', ')}) kaynak dosyada yok — metinden
              çıkarıldı. Kaynağa hiçbir şey yazılmaz; durumu değiştirirsen defterde tutulur.
            </div>
          ) : null}
          {entry.coerced?.length ? (
            <div>
              Tanınmayan değer taşıyan alanlar ({entry.coerced.join(', ')}) güvenli karşılığına
              çekildi — dosyadaki hâli korunuyor.
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {editing ? (
          <div className="mb-3 rounded-md border border-border bg-surface-1 px-3 py-2.5">
            <MetaFields handle={handle} />
          </div>
        ) : null}

        <TrackingCard entry={entry} onTrack={(patch) => onTrack(entry.id, patch)} />

        <div className="mb-3 rounded-md border border-border bg-surface-1 px-3 py-2">
          {!editing && entry.tags?.length ? (
            <MetaRow label="Etiketler">
              <span className="flex flex-wrap gap-1">
                {entry.tags.map((tag) => (
                  <TagChip key={tag} tag={tag} onClick={() => onTagClick(tag)} />
                ))}
              </span>
            </MetaRow>
          ) : null}
          {!editing && entry.area ? <MetaRow label="Alan">{entry.area}</MetaRow> : null}
          {entry.project ? <MetaRow label="Proje">{entry.project}</MetaRow> : null}
          {entry.refs?.commits?.length ? (
            <MetaRow label="Commit">
              <span className="font-mono text-[11px]">{entry.refs.commits.join(', ')}</span>
            </MetaRow>
          ) : null}
          {entry.refs?.files?.length ? (
            <MetaRow label="Dosyalar">
              <span className="font-mono text-[11px] break-all">{entry.refs.files.join(', ')}</span>
            </MetaRow>
          ) : null}
          {entry.refs?.urls?.length ? (
            <MetaRow label="Bağlantı">
              {entry.refs.urls.map((url) => (
                <button
                  key={url}
                  type="button"
                  onClick={() => void window.devlog.openExternal(url)}
                  className="mr-2 inline-flex items-center gap-0.5 text-primary underline decoration-1 underline-offset-2"
                >
                  {url}
                  <ArrowUpRight size={11} strokeWidth={1.5} />
                </button>
              ))}
            </MetaRow>
          ) : null}
          <MetaRow label="Güncellendi">
            <span className="numeric">
              {entry.updated_at ? absoluteDateTime(entry.updated_at) : '—'}
            </span>
          </MetaRow>
          <MetaRow label="id">
            <span className="selectable font-mono text-[11px] break-all text-muted-foreground">
              {entry.id}
            </span>
          </MetaRow>
        </div>

        {editing ? (
          <div className="rounded-md border border-border bg-card px-3 py-2">
            <BodyEditor value={handle.draft.body} onChange={(next) => handle.set('body', next)} />
          </div>
        ) : (
          <Markdown resolved={resolved} onOpenEntry={onOpenEntry}>
            {entry.body}
          </Markdown>
        )}

        {backlinks.length > 0 ? (
          <div className="mt-6 border-t border-border pt-3">
            <div className="mb-1.5 text-[10px] font-semibold tracking-[0.04em] text-muted-foreground uppercase">
              Buraya bağlananlar ({backlinks.length})
            </div>
            {backlinks.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => onOpenEntry(item.id)}
                className="flex w-full items-center gap-2 rounded-sm px-1.5 py-1 text-left text-[12px] transition-colors hover:bg-surface-2"
              >
                <CornerDownRight
                  size={12}
                  strokeWidth={1.5}
                  className="shrink-0 text-muted-foreground"
                />
                <span className="numeric shrink-0 text-muted-foreground">
                  {timeOfDay(item.occurred_at)}
                </span>
                <span className="truncate">{item.title}</span>
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {!entry.readOnly ? (
        <div className="flex shrink-0 items-center gap-2 border-t border-border px-4 py-2">
          {editing ? (
            <>
              <Button variant="primary" onClick={() => void save()} disabled={!handle.canSave}>
                Kaydet
              </Button>
              <Button onClick={leaveEdit}>Bitir</Button>
              <span className="ml-auto flex items-center gap-1.5 text-[11px] text-muted-foreground">
                {handle.dirty ? (
                  <span className="text-warning">kaydedilmedi</span>
                ) : (
                  <span>değişiklik yok</span>
                )}
                <Kbd>⌘S</Kbd>
              </span>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={onEdit}>
                <Pencil size={12} strokeWidth={1.5} /> Düzenle
              </Button>
              <span className="ml-auto text-[11px] text-muted-foreground">
                <Kbd>⌘E</Kbd>
              </span>
            </>
          )}
        </div>
      ) : null}
    </div>
  )
}
