import path from 'node:path'
import { BrowserWindow, screen } from 'electron'

const isDev = Boolean(process.env['ELECTRON_RENDERER_URL'])

const PRELOAD = path.join(__dirname, '../preload/index.js')

function rendererTarget(page: 'index' | 'capture'): { url?: string; file?: string } {
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) return { url: `${devUrl}/${page}.html` }
  return { file: path.join(__dirname, `../renderer/${page}.html`) }
}

function load(window: BrowserWindow, page: 'index' | 'capture'): void {
  const target = rendererTarget(page)
  if (target.url) void window.loadURL(target.url)
  else if (target.file) void window.loadFile(target.file)
}

export function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    backgroundColor: '#08090A',
    // Linear görünümü için özel başlık çubuğu: macOS'ta gömülü trafik ışıkları,
    // Windows'ta native kontrolleri kendi çubuğumuzun üstüne bindiren overlay.
    titleBarStyle: 'hidden',
    ...(process.platform === 'darwin'
      ? { trafficLightPosition: { x: 16, y: 18 } }
      : { titleBarOverlay: { color: '#08090A', symbolColor: '#8A8F98', height: 44 } }),
    webPreferences: {
      preload: PRELOAD,
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  window.once('ready-to-show', () => window.show())
  load(window, 'index')
  if (isDev) window.webContents.openDevTools({ mode: 'detach' })
  return window
}

const CAPTURE_WIDTH = 640
const CAPTURE_MIN_HEIGHT = 128

export function createCaptureWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: CAPTURE_WIDTH,
    height: CAPTURE_MIN_HEIGHT,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    backgroundColor: '#00000000',
    // macOS'ta `panel` tipi pencereyi tam ekran uygulamaların da üstünde tutar —
    // yakalama penceresinin tüm anlamı "ne yapıyorsan bırakmadan yaz".
    ...(process.platform === 'darwin' ? { type: 'panel', vibrancy: 'hud' as const } : {}),
    webPreferences: {
      preload: PRELOAD,
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  window.setAlwaysOnTop(true, 'screen-saver')
  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  load(window, 'capture')
  return window
}

/** İmleçin bulunduğu ekranın üst-orta bölgesine yerleştirir (Spotlight hissi). */
export function positionCaptureWindow(window: BrowserWindow): void {
  const cursor = screen.getCursorScreenPoint()
  const display = screen.getDisplayNearestPoint(cursor)
  const { x, y, width, height } = display.workArea
  // `getSize()` number[] döner; noUncheckedIndexedAccess altında varsayılan şart.
  const size = window.getSize()
  const winWidth = size[0] ?? CAPTURE_WIDTH
  window.setPosition(
    Math.round(x + (width - winWidth) / 2),
    Math.round(y + Math.min(height * 0.22, 220)),
    false,
  )
}

export function resizeCaptureWindow(window: BrowserWindow, contentHeight: number): void {
  const height = Math.max(CAPTURE_MIN_HEIGHT, Math.min(Math.round(contentHeight), 460))
  const size = window.getSize()
  const currentWidth = size[0] ?? CAPTURE_WIDTH
  if (size[1] === height) return
  window.setSize(currentWidth, height, false)
}
