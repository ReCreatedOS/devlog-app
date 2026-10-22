import { useEffect, useState, type ReactNode } from 'react'
import { ACCENTS, ACTIVE_STATUSES, FONTS, LAYOUTS, STATUS_LABEL, THEMES } from '@devlog/core/shared'
import type { EntryStatus } from '@devlog/core/shared'
import { Database, Keyboard, ListChecks, Palette, X } from 'lucide-react'
import { cn } from '../lib/cn'
import type { AppSettings } from '../../../shared/ipc.js'
import { Button, IconButton, Kbd } from './primitives'

type SectionId = 'gorunum' | 'takip' | 'kaynaklar' | 'kisayol'

const SECTIONS: Array<{ id: SectionId; label: string; icon: ReactNode; hint: string }> = [
  { id: 'gorunum', label: 'Görünüm', icon: <Palette size={14} strokeWidth={1.5} />, hint: 'tema, açılış, yoğunluk' },
  { id: 'takip', label: 'Takip', icon: <ListChecks size={14} strokeWidth={1.5} />, hint: 'bayatlık eşikleri' },
  { id: 'kaynaklar', label: 'Kaynaklar', icon: <Database size={14} strokeWidth={1.5} />, hint: 'hangi kökler taranıyor' },
  { id: 'kisayol', label: 'Kısayol', icon: <Keyboard size={14} strokeWidth={1.5} />, hint: 'global yakalama tuşu' },
]

interface SettingsPanelProps {
  settings: AppSettings
  staleCount: number
  onChange: (patch: Partial<AppSettings>) => void
  onClose: () => void
  onReindex: () => void
}

/**
 * Ayarlar, ayrı bir pencere değil ana pencerenin üstünde bir katman.
 *
 * Sebep: ayarların yarısı canlı önizleme istiyor ("bu eşikle şu an kaç kayıt
 * bayat", "bu kökte kaç kayıt var"). Ayrı pencerede bu veriyi ikinci kez kurmak
 * gerekirdi ve yönetilecek ikinci bir pencere, günlük açma alışkanlığının
 * önündeki sürtünmedir.
 *
 * Buraya yalnız KARAR olan şeyler girer. Araç çubuğunda kontrolü olan bir şey
 * (yoğunluk gibi) burada tekrar edilmez — burada yalnız hatırlanıp
 * hatırlanmayacağına karar verilir.
 */
export function SettingsPanel({
  settings,
  staleCount,
  onChange,
  onClose,
  onReindex,
}: SettingsPanelProps): ReactNode {
  const [section, setSection] = useState<SectionId>('gorunum')

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [onClose])

  return (
    <div className="absolute inset-0 z-40 flex flex-col bg-background">
      <header className="drag-region flex h-11 shrink-0 items-center gap-2 border-b border-border px-3 pl-20">
        <span className="text-[13px] font-semibold">Ayarlar</span>
        <span className="text-[12px] text-muted-foreground">· {settings.vaultRoot}</span>
        <div className="ml-auto">
          <IconButton onClick={onClose} title="Kapat (Esc)">
            <X size={14} strokeWidth={1.5} />
          </IconButton>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <nav className="w-56 shrink-0 border-r border-border p-2">
          {SECTIONS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setSection(item.id)}
              className={cn(
                'flex w-full items-start gap-2 rounded-sm px-2 py-1.5 text-left transition-colors',
                section === item.id
                  ? 'bg-surface-2 text-foreground'
                  : 'text-muted-foreground hover:bg-surface-2/60 hover:text-foreground',
              )}
            >
              <span className="mt-0.5">{item.icon}</span>
              <span className="min-w-0">
                <span className="block text-[13px] font-medium">{item.label}</span>
                <span className="block truncate text-[11px] text-muted-foreground">
                  {item.hint}
                </span>
              </span>
            </button>
          ))}
        </nav>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {section === 'gorunum' ? (
            <Section title="Görünüm">
              <div className="mb-6">
                <div className="mb-1 text-[13px] font-medium">Tema</div>
                <div className="mb-3 text-[12px] leading-relaxed text-muted-foreground">
                  Tema yalnız nötr rampayı değiştirir. Severity renkleri (kritik kırmızısı,
                  yüksek turuncusu…) her temada aynı kalır — burada renk "aciliyet" demek ve
                  o sinyalin sabit olması gerekir.
                </div>
                <div className="max-w-3xl">
                  <div className="grid grid-cols-4 gap-2">
                    <ThemeCard
                      id="system"
                      label="Sistem"
                      hint="İşletim sisteminin gece/gündüz kararını izler"
                      swatch={['#08090a', '#1d1e21', '#fbfbfc']}
                      active={settings.theme === 'system'}
                      onSelect={() => onChange({ theme: 'system' })}
                    />
                  </div>

                  {(['dark', 'light'] as const).map((scheme) => (
                    <div key={scheme}>
                      <div className="mt-4 mb-2 text-[10px] font-semibold tracking-[0.08em] text-ink-3 uppercase">
                        {scheme === 'dark' ? 'Koyu' : 'Açık'}
                      </div>
                      <div className="grid grid-cols-4 gap-2">
                        {THEMES.filter((theme) => theme.scheme === scheme).map((theme) => (
                          <ThemeCard
                            key={theme.id}
                            id={theme.id}
                            label={theme.label}
                            hint={theme.hint}
                            swatch={theme.swatch}
                            active={settings.theme === theme.id}
                            onSelect={() => onChange({ theme: theme.id })}
                          />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="mb-6">
                <div className="mb-1 text-[13px] font-medium">Vurgu rengi</div>
                <div className="mb-3 text-[12px] leading-relaxed text-muted-foreground">
                  Yalnız etkileşimi işaretler: seçili satır, odak halkası, birincil düğme.
                  Temadan bağımsızdır.
                </div>
                <div className="flex flex-wrap gap-2">
                  {ACCENTS.map((accent) => (
                    <button
                      key={accent.id}
                      type="button"
                      onClick={() => onChange({ accent: accent.id })}
                      title={accent.label}
                      className={cn(
                        'flex h-8 items-center gap-2 rounded-sm border px-2.5 text-[12px] transition-colors',
                        settings.accent === accent.id
                          ? 'border-border-strong bg-surface-2 text-foreground'
                          : 'border-border text-muted-foreground hover:text-foreground',
                      )}
                    >
                      <span
                        className="h-3 w-3 rounded-full"
                        style={{ backgroundColor: accent.color }}
                      />
                      {accent.label}
                    </button>
                  ))}
                </div>
              </div>

              <Choice
                label="Yazı tipi"
                hint="Jakarta uygulamayla birlikte paketlenir — çevrimdışı da, başka makinede de aynı yüz."
                value={settings.font}
                options={FONTS.map((f) => ({ value: f.id, label: f.label }))}
                onChange={(font) => onChange({ font: font as AppSettings['font'] })}
              />

              <Choice
                label="Yerleşim"
                hint="Detay paneli sağda mı, listenin altında mı dursun. ⌘/ ile her zaman gizlenebilir."
                value={settings.layout}
                options={LAYOUTS.map((l) => ({ value: l.id, label: l.label }))}
                onChange={(layout) => onChange({ layout: layout as AppSettings['layout'] })}
              />
              <Choice
                label="Açılışta"
                hint="Uygulamayı ne için açtığın kişiye göre değişir: geçmişi okumak mı, açık işleri görmek mi."
                value={settings.startup}
                options={[
                  { value: 'tracker', label: 'Takip — ne duruyor' },
                  { value: 'list', label: 'Liste — ne oldu' },
                  { value: 'resume', label: 'Bıraktığın yer' },
                ]}
                onChange={(startup) => onChange({ startup: startup as AppSettings['startup'] })}
              />
              <Choice
                label="Satır yoğunluğu"
                hint="Rahat kipte satır altında özet çıkar. Araç çubuğundan da değiştirilebilir; burada hatırlanır."
                value={settings.density}
                options={[
                  { value: 'compact', label: 'Sıkı' },
                  { value: 'comfortable', label: 'Rahat' },
                ]}
                onChange={(density) => onChange({ density: density as AppSettings['density'] })}
              />
            </Section>
          ) : null}

          {section === 'takip' ? (
            <Section title="Bayatlık eşikleri">
              <p className="mb-3 max-w-prose text-[12px] leading-relaxed text-muted-foreground">
                Bir kayıt aynı durumda bu kadar gün kalırsa <b>bayat</b> sayılır ve takip
                listesinin başına çıkar. Kapanmış durumlar (düzeltildi, tamam, yapılmayacak)
                bilinçli olarak bayatlamaz. Bu eşikler ajanla paylaşılır — MCP'nin{' '}
                <code className="font-mono">stale</code> alanı da bunları kullanır.
              </p>
              <div className="mb-4 rounded-md border border-border bg-surface-1 px-3 py-2 text-[12px]">
                Şu anki eşiklerle <span className="numeric font-medium">{staleCount}</span> kayıt
                bayat.
              </div>
              <div className="grid max-w-md grid-cols-2 gap-3">
                {ACTIVE_STATUSES.map((status) => (
                  <label key={status} className="flex flex-col gap-1">
                    <span className="text-[11px] text-muted-foreground">
                      {STATUS_LABEL[status]}
                    </span>
                    <div className="flex items-center gap-1.5">
                      <input
                        type="number"
                        min={1}
                        max={365}
                        value={settings.staleAfterDays[status] ?? ''}
                        onChange={(event) => {
                          const days = Number(event.target.value)
                          if (!Number.isFinite(days) || days <= 0) return
                          onChange({
                            staleAfterDays: { [status as EntryStatus]: Math.round(days) },
                          })
                        }}
                        className="numeric h-7 w-20 rounded-xs border border-border bg-surface-1 px-1.5 text-[12px] focus:border-border-strong focus:outline-none"
                      />
                      <span className="text-[11px] text-muted-foreground">gün</span>
                    </div>
                  </label>
                ))}
              </div>
            </Section>
          ) : null}

          {section === 'kaynaklar' ? (
            <Section title="Kaynak kökleri">
              <p className="mb-3 max-w-prose text-[12px] leading-relaxed text-muted-foreground">
                Kapatılan kök taranmaz ve kayıtları listeden düşer — dosyalara dokunulmaz.
                Aynalar salt-okunurdur: durumlarını değiştirdiğinde değişiklik defterdeki takip
                dosyasına yazılır.
              </p>
              <div className="max-w-2xl divide-y divide-border rounded-md border border-border">
                {settings.sources.map((source) => {
                  const isVault = source.id === 'vault'
                  const enabled = source.enabled !== false
                  return (
                    <div key={source.id} className="flex items-center gap-3 px-3 py-2.5">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 text-[13px]">
                          <span className="font-medium">{source.label}</span>
                          {source.readOnly ? (
                            <span className="text-[10px] text-muted-foreground">salt-okunur</span>
                          ) : null}
                        </div>
                        <div className="truncate font-mono text-[11px] text-muted-foreground">
                          {source.root}
                        </div>
                      </div>
                      <span className="numeric text-[11px] text-muted-foreground">
                        {source.count} kayıt
                      </span>
                      <button
                        type="button"
                        disabled={isVault}
                        onClick={() =>
                          onChange({
                            sources: [{ ...source, enabled: !enabled }],
                          })
                        }
                        title={isVault ? 'Defterin kendisi kapatılamaz' : undefined}
                        className={cn(
                          'h-6 w-11 shrink-0 rounded-full border transition-colors',
                          enabled ? 'border-primary/40 bg-primary/25' : 'border-border bg-surface-2',
                          isVault && 'opacity-40',
                        )}
                      >
                        <span
                          className={cn(
                            'block h-4 w-4 rounded-full bg-foreground/80 transition-transform',
                            enabled ? 'translate-x-6' : 'translate-x-1',
                          )}
                        />
                      </button>
                    </div>
                  )
                })}
              </div>
              <div className="mt-3">
                <Button variant="outline" onClick={onReindex}>
                  Yeniden tara
                </Button>
              </div>
            </Section>
          ) : null}

          {section === 'kisayol' ? (
            <Section title="Global yakalama kısayolu">
              <p className="mb-4 max-w-prose text-[12px] leading-relaxed text-muted-foreground">
                Uygulama <b>arkadayken</b> bu tuş, ekranın ortasında tek satırlık bir yakalama
                penceresi açar: yazarsın, <Kbd>↵</Kbd> ile kaydolur, pencere kapanır ve ne
                yapıyorsan ona dönersin. Uygulamayı öne getirmen gerekmez.
              </p>

              <HotkeyRecorder
                value={settings.hotkey}
                registered={settings.hotkeyRegistered}
                onChange={(hotkey) => onChange({ hotkey })}
              />

              <p className="mt-4 max-w-prose text-[12px] leading-relaxed text-muted-foreground">
                Uygulama açıkken <Kbd>⌘⇧N</Kbd> aynı pencereyi açar; <Kbd>⌘N</Kbd> ise kaydı
                doğrudan uygulamanın içinde oluşturur. Yakalama satırında tür ve etiket
                yazabilirsin:{' '}
                <code className="font-mono text-[11px]">
                  r2 bucket public kalmış /sec !kritik @cdn #r2
                </code>
              </p>
            </Section>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }): ReactNode {
  return (
    <section>
      <h2 className="mb-4 text-[15px] font-semibold">{title}</h2>
      {children}
    </section>
  )
}

function Choice({
  label,
  hint,
  value,
  options,
  onChange,
}: {
  label: string
  hint: string
  value: string
  options: Array<{ value: string; label: string }>
  onChange: (next: string) => void
}): ReactNode {
  return (
    <div className="mb-5 max-w-xl">
      <div className="mb-1 text-[13px] font-medium">{label}</div>
      <div className="mb-2 text-[12px] leading-relaxed text-muted-foreground">{hint}</div>
      <div className="inline-flex rounded-xs border border-border p-px">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            className={cn(
              'h-7 rounded-[5px] px-3 text-[12px] transition-colors',
              value === option.value
                ? 'bg-surface-2 text-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  )
}

/**
 * Kısayol kaydedici.
 *
 * Elle "CommandOrControl+Shift+L" yazdırmak yerine tuşa bastırıyoruz: Electron'un
 * hızlandırıcı yazımını kimse ezberlemek zorunda değil. Ayrıca kısayolun
 * gerçekten ALINIP alınmadığını gösteriyoruz — ayar dosyasında yazması
 * çalıştığı anlamına gelmiyor, kombinasyonu başka bir uygulama tutuyor olabilir
 * (macOS'ta ⌥Space ve ⌘Space sık kapılır).
 */
function HotkeyRecorder({
  value,
  registered,
  onChange,
}: {
  value: string
  registered: boolean
  onChange: (next: string) => void
}): ReactNode {
  const [recording, setRecording] = useState(false)

  useEffect(() => {
    if (!recording) return
    const onKey = (event: KeyboardEvent): void => {
      event.preventDefault()
      event.stopPropagation()
      if (event.key === 'Escape') {
        setRecording(false)
        return
      }
      const accelerator = toAccelerator(event)
      if (!accelerator) return // Yalnız değiştirici tuşlar — kullanıcı henüz bitirmedi.
      setRecording(false)
      onChange(accelerator)
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [recording, onChange])

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        onClick={() => setRecording((v) => !v)}
        className={cn(
          'h-9 min-w-56 rounded-sm border px-3 text-[13px] transition-colors',
          recording
            ? 'border-primary bg-primary/10 text-foreground'
            : 'border-border bg-surface-1 hover:border-border-strong',
        )}
      >
        {recording ? 'Tuş kombinasyonuna bas…' : prettyAccelerator(value)}
      </button>

      <span
        className={cn(
          'inline-flex items-center gap-1.5 text-[12px]',
          registered ? 'text-success' : 'text-warning',
        )}
      >
        <span
          className={cn('h-1.5 w-1.5 rounded-full', registered ? 'bg-success' : 'bg-warning')}
        />
        {registered ? 'kayıtlı ve çalışıyor' : 'alınamadı — başka bir uygulama tutuyor'}
      </span>

      {recording ? (
        <span className="text-[11px] text-muted-foreground">
          <Kbd>Esc</Kbd> vazgeç
        </span>
      ) : null}
    </div>
  )
}

const MAC = navigator.platform.toLowerCase().includes('mac')

/** Tarayıcı olayını Electron hızlandırıcı yazımına çevirir. */
function toAccelerator(event: KeyboardEvent): string | null {
  const parts: string[] = []
  if (event.metaKey) parts.push('Command')
  if (event.ctrlKey) parts.push('Control')
  if (event.altKey) parts.push('Alt')
  if (event.shiftKey) parts.push('Shift')

  const code = event.code
  let key: string | null = null
  if (code.startsWith('Key')) key = code.slice(3)
  else if (code.startsWith('Digit')) key = code.slice(5)
  else if (code === 'Space') key = 'Space'
  else if (code.startsWith('F') && /^F\d{1,2}$/.test(code)) key = code
  else if (['Comma', 'Period', 'Slash', 'Backslash', 'Enter', 'Backspace'].includes(code)) {
    key = { Comma: ',', Period: '.', Slash: '/', Backslash: '\\', Enter: 'Return', Backspace: 'Backspace' }[code] ?? null
  }
  // Değiştiricisiz bir kısayol tüm sistemde o tuşu yutar — kabul etmiyoruz.
  if (!key || parts.length === 0) return null
  return [...parts, key].join('+')
}

/** `Alt+Space` → `⌥Space`. macOS dışında olduğu gibi bırakılır. */
function prettyAccelerator(value: string): string {
  if (!MAC) return value
  return value
    .replace(/CommandOrControl|Command|Cmd/g, '⌘')
    .replace(/Control|Ctrl/g, '⌃')
    .replace(/Alt|Option/g, '⌥')
    .replace(/Shift/g, '⇧')
    .replace(/\+/g, '')
}

/** Tema kartı: renkleri anlatmak yerine gösteriyoruz. */
function ThemeCard({
  id,
  label,
  hint,
  swatch,
  active,
  onSelect,
}: {
  id: string
  label: string
  hint: string
  swatch: [string, string, string]
  active: boolean
  onSelect: () => void
}): ReactNode {
  return (
    <button
      type="button"
      onClick={onSelect}
      title={hint}
      className={cn(
        'flex flex-col gap-2 rounded-md border p-2 text-left transition-colors',
        active
          ? 'border-primary/60 bg-surface-2'
          : 'border-border hover:border-border-strong hover:bg-surface-1',
      )}
    >
      {/* Önizleme, temayı anlatmak yerine gerçek bir liste satırını taklit eder:
          zemin + yüzey + iki metin satırı + severity oluğu. */}
      <span
        className="relative flex h-12 flex-col justify-center gap-1.5 overflow-hidden rounded-xs border border-border/60 px-2"
        aria-hidden
        style={{ backgroundColor: swatch[0] }}
        data-theme-preview={id}
      >
        <span className="absolute inset-y-0 left-0 w-[3px]" style={{ backgroundColor: '#e2620e' }} />
        <span className="flex items-center gap-1.5">
          <span
            className="h-1.5 w-6 rounded-full"
            style={{ backgroundColor: swatch[1], opacity: 0.9 }}
          />
          <span className="h-1.5 flex-1 rounded-full" style={{ backgroundColor: swatch[2], opacity: 0.75 }} />
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-1.5 w-6 rounded-full" style={{ backgroundColor: swatch[1] }} />
          <span
            className="h-1.5 w-2/3 rounded-full"
            style={{ backgroundColor: swatch[2], opacity: 0.35 }}
          />
        </span>
      </span>
      <span className="flex items-center gap-1.5 text-[12px] font-medium">
        {label}
        {active ? <span className="h-1.5 w-1.5 rounded-full bg-primary" /> : null}
      </span>
    </button>
  )
}
