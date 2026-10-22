import { readlinkSync, rmSync } from 'node:fs'
import path from 'node:path'
import { BrowserWindow, Menu, app, globalShortcut, ipcMain, nativeTheme, shell } from 'electron'
import {
  DEFAULT_ACCENT,
  DEFAULT_FONT,
  DEFAULT_LAYOUT,
  DEFAULT_THEME,
  captureToDraft,
  parseCapture,
  themeInfo,
} from '@devlog/core'
import type { EntryDraft, EntryFrontmatter, QueryFilter, TrackingPatch } from '@devlog/core'
import { CHANNELS } from '../shared/ipc.js'
import type { AppSettings, CaptureOutcome } from '../shared/ipc.js'
import { DEFAULT_HOTKEY, loadAppConfig, saveAppConfig, type AppConfig } from './config.js'
import { Library } from './library.js'
import {
  createCaptureWindow,
  createMainWindow,
  positionCaptureWindow,
  resizeCaptureWindow,
} from './windows.js'

let library: Library | null = null
let mainWindow: BrowserWindow | null = null
let captureWindow: BrowserWindow | null = null
/** Global kısayol gerçekten alınabildi mi — ayarlar ekranı bunu gösterir. */
let hotkeyRegistered = false

function broadcast(channel: string, ...args: unknown[]): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(channel, ...args)
  }
}

function ensureMainWindow(): BrowserWindow {
  if (!mainWindow || mainWindow.isDestroyed()) mainWindow = createMainWindow()
  return mainWindow
}

function ensureCaptureWindow(): BrowserWindow {
  if (!captureWindow || captureWindow.isDestroyed()) {
    captureWindow = createCaptureWindow()
    // Odak kaybında kapanmak Spotlight davranışıdır; yazdığın şey kaybolmasın
    // diye renderer kapanmadan önce içeriği boşsa onay sormaz, doluysa sorar.
    captureWindow.on('blur', () => {
      if (captureWindow && !captureWindow.isDestroyed()) captureWindow.hide()
    })
  }
  return captureWindow
}

function toggleCapture(): void {
  const window = ensureCaptureWindow()
  if (window.isVisible()) {
    window.hide()
    return
  }
  positionCaptureWindow(window)
  window.show()
  window.focus()
}

function buildMenu(): void {
  const isMac = process.platform === 'darwin'
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac
      ? ([{ role: 'appMenu' as const }] satisfies Electron.MenuItemConstructorOptions[])
      : []),
    {
      label: 'Kayıt',
      submenu: [
        {
          label: 'Yeni kayıt',
          accelerator: 'CmdOrCtrl+N',
          click: () => {
            ensureMainWindow().show()
            broadcast(CHANNELS.newEntry)
          },
        },
        {
          label: 'Hızlı yakalama',
          accelerator: 'CmdOrCtrl+Shift+N',
          click: () => toggleCapture(),
        },
        { type: 'separator' },
        {
          label: 'Yeniden indeksle',
          accelerator: 'CmdOrCtrl+Shift+R',
          click: () => void library?.reindex(),
        },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    // macOS'ta menü olmadan kopyala/yapıştır çalışmaz — bu blok kozmetik değil.
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function registerIpc(lib: Library): void {
  ipcMain.handle(CHANNELS.query, (_e, filter: QueryFilter, limit?: number, offset?: number) =>
    lib.query(filter, limit, offset),
  )
  ipcMain.handle(CHANNELS.facets, () => lib.facets())
  ipcMain.handle(CHANNELS.detail, (_e, id: string) => lib.detail(id))
  ipcMain.handle(CHANNELS.create, (_e, draft: EntryDraft) => lib.create(draft))
  ipcMain.handle(
    CHANNELS.save,
    (_e, id: string, frontmatter: EntryFrontmatter, body: string, baseUpdatedAt?: string) =>
      lib.save(id, frontmatter, body, baseUpdatedAt),
  )
  ipcMain.handle(CHANNELS.track, (_e, id: string, patch: TrackingPatch) =>
    lib.setTracking(id, patch, 'user'),
  )
  ipcMain.handle(CHANNELS.remove, (_e, id: string) => lib.remove(id))
  ipcMain.handle(CHANNELS.status, () => lib.status())
  ipcMain.handle(CHANNELS.settings, () => readSettings(lib))
  ipcMain.handle(CHANNELS.updateSettings, (_e, patch: Partial<AppSettings>) =>
    updateSettings(lib, patch),
  )
  ipcMain.handle(CHANNELS.reindex, () => lib.reindex())
  ipcMain.handle(CHANNELS.resolve, (_e, ids: string[]) => lib.resolve(ids))
  ipcMain.handle(CHANNELS.reveal, (_e, id: string) => {
    const target = lib.pathFor(id)
    if (target) shell.showItemInFolder(target)
  })
  ipcMain.handle(CHANNELS.openExternal, (_e, url: string) => {
    // Yalnız http(s) — `file:` ya da özel şemalarla keyfi hedef açtırmayalım.
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
  })

  ipcMain.handle(CHANNELS.captureSubmit, async (_e, text: string): Promise<CaptureOutcome> => {
    const parsed = parseCapture(text)
    if (!parsed.title) return { ok: false, message: 'Başlık boş olamaz.' }
    try {
      const entry = await lib.create(captureToDraft(parsed))
      return { ok: true, id: entry.id }
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : 'Kayıt yazılamadı.' }
    }
  })

  ipcMain.on(CHANNELS.captureClose, () => {
    if (captureWindow && !captureWindow.isDestroyed()) captureWindow.hide()
  })
  ipcMain.on(CHANNELS.captureResize, (_e, height: number) => {
    if (captureWindow && !captureWindow.isDestroyed()) resizeCaptureWindow(captureWindow, height)
  })
  ipcMain.on(CHANNELS.captureOpenMain, (_e, id?: string) => {
    if (captureWindow && !captureWindow.isDestroyed()) captureWindow.hide()
    const window = ensureMainWindow()
    window.show()
    window.focus()
    if (id) window.webContents.send(CHANNELS.focusEntry, id)
  })
}

function readSettings(lib: Library): AppSettings {
  const config = lib.config
  const status = lib.status()
  return {
    theme: config.ui?.theme ?? DEFAULT_THEME,
    accent: config.ui?.accent ?? DEFAULT_ACCENT,
    font: config.ui?.font ?? DEFAULT_FONT,
    layout: config.ui?.layout ?? DEFAULT_LAYOUT,
    startup: config.ui?.startup ?? 'list',
    density: config.ui?.density ?? 'compact',
    hotkey: config.hotkey,
    hotkeyRegistered,
    staleAfterDays: status.staleAfterDays,
    vaultRoot: config.vaultRoot,
    sources: status.sources,
  }
}

/**
 * Ayarı yaz, ETKİSİNİ HEMEN uygula, sonra diske kaydet.
 *
 * Sıra önemli: tema ve kısayol gibi şeyler yalnız dosyaya yazılıp uygulanmazsa
 * kullanıcı "ayar çalışmıyor" der ve haklıdır — bir ayar, sonucu görünene kadar
 * bir dilek olarak kalır.
 */
async function updateSettings(lib: Library, patch: Partial<AppSettings>): Promise<AppSettings> {
  const current = lib.config
  const next: AppConfig = {
    ...current,
    hotkey: patch.hotkey ? normalizeAccelerator(patch.hotkey) : current.hotkey,
    ui: {
      ...current.ui,
      ...(patch.theme ? { theme: patch.theme } : {}),
      ...(patch.accent ? { accent: patch.accent } : {}),
      ...(patch.font ? { font: patch.font } : {}),
      ...(patch.layout ? { layout: patch.layout } : {}),
      ...(patch.startup ? { startup: patch.startup } : {}),
      ...(patch.density ? { density: patch.density } : {}),
    },
    tracking: patch.staleAfterDays
      ? { staleAfterDays: { ...current.tracking?.staleAfterDays, ...patch.staleAfterDays } }
      : current.tracking,
    sources: patch.sources
      ? current.sources.map((source) => {
          const updated = patch.sources?.find((s) => s.id === source.id)
          return updated ? { ...source, enabled: updated.enabled !== false } : source
        })
      : current.sources,
  }

  if (patch.theme) applyTheme(patch.theme)
  if (patch.hotkey && patch.hotkey !== current.hotkey) applyHotkey(next.hotkey)

  await saveAppConfig(next)
  await lib.applyConfig(next)
  broadcast(CHANNELS.statusChanged)
  return readSettings(lib)
}

/**
 * İşletim sistemine hangi şemada olduğumuzu söyler: pencere çerçevesi, native
 * menüler ve trafik ışıkları buna göre çizilir. Tema id'si şemaya çevrilir.
 */
function applyTheme(theme: string): void {
  nativeTheme.themeSource = theme === 'system' ? 'system' : themeInfo(theme).scheme
}

/**
 * Elle yazılmış hızlandırıcıları hoşgörür.
 *
 * Electron ayıracı `+` ister; kullanıcılar (ve macOS alışkanlığı) `-` ya da
 * boşluk yazıyor. `Control-Space` kaydı sessizce başarısız oluyordu — yazımı
 * reddetmek yerine düzeltiyoruz.
 */
function normalizeAccelerator(value: string): string {
  return value
    .trim()
    .split(/[+\-\s]+/)
    .filter(Boolean)
    .map((part) => (part.toLowerCase() === 'cmd' ? 'Command' : part))
    .join('+')
}

/**
 * Kısayolu kaydeder. Alınamazsa (başka uygulama kapmışsa ya da kombinasyon
 * geçersizse) varsayılana döner ve bunu BİLDİRİR — sessizce çalışmayan bir
 * kısayol, kullanıcının özelliği hiç keşfetmemesi demek.
 */
function applyHotkey(raw: string): boolean {
  const hotkey = normalizeAccelerator(raw)
  globalShortcut.unregisterAll()
  try {
    if (globalShortcut.register(hotkey, toggleCapture)) {
      hotkeyRegistered = true
      return true
    }
  } catch {
    // Geçersiz kombinasyon — aşağıda varsayılana düşüyoruz.
  }
  hotkeyRegistered = DEFAULT_HOTKEY !== hotkey && globalShortcut.register(DEFAULT_HOTKEY, toggleCapture)
  return false
}

/** Chromium'un kilit dosyaları — `SingletonLock` `<host>-<pid>`e symlink'tir. */
const SINGLETON_FILES = ['SingletonLock', 'SingletonSocket', 'SingletonCookie']

/**
 * Bayat tek-örnek kilidini temizler.
 *
 * Uygulama sert kapatılırsa (Force Quit, SIGKILL, çökme) bu dosyalar diskte
 * kalıyor ve uygulama bir daha AÇILMIYOR — üstelik hiçbir geri bildirim
 * vermeden, çünkü `app.quit()` sessizce çıkıyor. Kullanıcı çift tıklıyor,
 * hiçbir şey olmuyor.
 *
 * Kilidin işaret ettiği PID yaşamıyorsa dosyaları silip kilidi yeniden
 * deniyoruz. PID yaşıyorsa gerçekten ikinci örneğiz — dokunmuyoruz.
 */
function reclaimStaleInstanceLock(): boolean {
  const userData = app.getPath('userData')
  let target: string
  try {
    target = readlinkSync(path.join(userData, 'SingletonLock'))
  } catch {
    return false // Kilit dosyası yok ya da symlink değil — bizim vakamız değil.
  }

  const pid = Number(target.slice(target.lastIndexOf('-') + 1))
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0) // Sinyal göndermez, yalnız varlığı sınar.
    return false // Süreç yaşıyor: gerçekten başka bir örnek çalışıyor.
  } catch {
    // ESRCH — sahibi ölmüş.
  }

  console.warn(`[devlog] Bayat tek-örnek kilidi temizleniyor (ölü pid ${pid}).`)
  for (const name of SINGLETON_FILES) {
    rmSync(path.join(userData, name), { force: true })
  }
  return true
}

function acquireInstanceLock(): boolean {
  if (app.requestSingleInstanceLock()) return true
  if (reclaimStaleInstanceLock() && app.requestSingleInstanceLock()) return true
  return false
}

if (!acquireInstanceLock()) {
  console.warn('[devlog] Zaten çalışan bir örnek var; ona devrediliyor.')
  app.quit()
} else {
  app.on('second-instance', () => {
    const window = ensureMainWindow()
    if (window.isMinimized()) window.restore()
    window.focus()
  })

  void app.whenReady().then(async () => {
    const config = await loadAppConfig()

    library = new Library(config)
    library.on('changed', (id?: string) => broadcast(CHANNELS.changed, id))
    library.on('status', () => broadcast(CHANNELS.statusChanged))

    registerIpc(library)
    buildMenu()
    ensureMainWindow()

    // İlk tarama pencereyi bloklamaz — UI "indeksleniyor" durumunu gösterir.
    void library.init().then(() => {
      const state = library?.status()
      if (!state) return
      // Başlangıç teşhisi: hangi kökler bağlandı, kaç kayıt okundu, kaç dosya
      // şemaya uymadı. Bir şey görünmediğinde ilk bakılacak yer burası.
      console.log(
        `[devlog] ${state.count} kayıt · ${state.sources
          .map((s) => `${s.label}=${s.count}`)
          .join(' · ')}${state.failures.length ? ` · ${state.failures.length} hatalı dosya` : ''}`,
      )
    })

    applyTheme(config.ui?.theme ?? DEFAULT_THEME)
    if (!applyHotkey(config.hotkey)) {
      console.warn(`[devlog] Global kısayol alınamadı: ${config.hotkey}`)
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) ensureMainWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('will-quit', () => {
    globalShortcut.unregisterAll()
    void library?.dispose()
  })
}
