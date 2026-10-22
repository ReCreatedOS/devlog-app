/**
 * Tema kataloğu.
 *
 * Tema = nötr rampa + kenarlık + gölge. Anlam taşıyan renkler (severity beşlisi,
 * durum tonları) temaya göre DEĞİŞMEZ: bu arayüzde renk "aciliyet" demek ve
 * kullanıcı temayı değiştirdiğinde kritik kırmızısının kayması, öğrendiği tek
 * sinyali bozardı.
 *
 * Vurgu rengi (`accent`) ayrı bir eksen: temayla çarpışmaz, yalnız `--primary`
 * ve `--ring`'i değiştirir.
 */

export type ThemeScheme = 'dark' | 'light'

export interface ThemeInfo {
  id: string
  label: string
  scheme: ThemeScheme
  /** Ayarlardaki örnek kare: [arka plan, yüzey, metin]. */
  swatch: [string, string, string]
  hint: string
}

export const THEMES: ThemeInfo[] = [
  // ── Koyu ───────────────────────────────────────────────────────────────────
  {
    id: 'gece',
    label: 'Gece',
    scheme: 'dark',
    swatch: ['#08090a', '#1d1e21', '#f2f3f4'],
    hint: 'Nötr siyah — varsayılan',
  },
  {
    id: 'murekkep',
    label: 'Mürekkep',
    scheme: 'dark',
    swatch: ['#070b14', '#172034', '#e7ecf6'],
    hint: 'Soğuk lacivert; uzun oturumlarda yumuşak',
  },
  {
    id: 'okyanus',
    label: 'Okyanus',
    scheme: 'dark',
    swatch: ['#04100f', '#113230', '#e4f4f2'],
    hint: 'Derin turkuaz; berrak ve serin',
  },
  {
    id: 'orman',
    label: 'Orman',
    scheme: 'dark',
    swatch: ['#060d0a', '#16261f', '#e8f3ec'],
    hint: 'Koyu yeşil; en sakin koyu tema',
  },
  {
    id: 'ametist',
    label: 'Ametist',
    scheme: 'dark',
    swatch: ['#0b0813', '#221a37', '#efe9f8'],
    hint: 'Mor; gece çalışmaları için',
  },
  {
    id: 'sarap',
    label: 'Şarap',
    scheme: 'dark',
    swatch: ['#100609', '#33161f', '#f7e9ee'],
    hint: 'Bordo; sıcak ve doygun',
  },
  {
    id: 'komur',
    label: 'Kömür',
    scheme: 'dark',
    swatch: ['#0d0a08', '#2b211a', '#f6f1eb'],
    hint: 'Sıcak nötr; kâğıt hissi olan koyu',
  },
  {
    id: 'kontrast',
    label: 'Kontrast',
    scheme: 'dark',
    swatch: ['#000000', '#1f1f1f', '#ffffff'],
    hint: 'Saf siyah, kalın kenarlık — OLED ve düşük ışık',
  },

  // ── Açık ───────────────────────────────────────────────────────────────────
  {
    id: 'gun',
    label: 'Gün',
    scheme: 'light',
    swatch: ['#fbfbfc', '#e9eaee', '#101114'],
    hint: 'Nötr aydınlık — varsayılan açık',
  },
  {
    id: 'ayaz',
    label: 'Ayaz',
    scheme: 'light',
    swatch: ['#f4f8fd', '#dde8f5', '#0d1622'],
    hint: 'Serin mavi; Mürekkep\'in gündüzü',
  },
  {
    id: 'adacayi',
    label: 'Adaçayı',
    scheme: 'light',
    swatch: ['#f5f8f4', '#dde8d9', '#10170f'],
    hint: 'Yumuşak yeşil; göz yormayan aydınlık',
  },
  {
    id: 'kagit',
    label: 'Kâğıt',
    scheme: 'light',
    swatch: ['#faf7f1', '#eae2d4', '#1c1917'],
    hint: 'Sıcak sepya; ekrandan çok deftere benzer',
  },
  {
    id: 'gulkurusu',
    label: 'Gülkurusu',
    scheme: 'light',
    swatch: ['#fdf6f5', '#f3dedd', '#1f1414'],
    hint: 'Sıcak pembe; en yumuşak açık tema',
  },
]

export const DEFAULT_THEME = 'gece'

export function themeInfo(id: string | undefined): ThemeInfo {
  return THEMES.find((t) => t.id === id) ?? THEMES[0]!
}

export interface AccentInfo {
  id: string
  label: string
  color: string
}

/**
 * Vurgu rengi yalnız ETKİLEŞİMİ işaretler (seçim, odak, birincil düğme, bağlantı).
 * Severity renkleriyle karışmaması için doygunluğu yüksek tonlar seçildi.
 */
export const ACCENTS: AccentInfo[] = [
  { id: 'vermilyon', label: 'Vermilyon', color: '#ff5a1f' },
  { id: 'kehribar', label: 'Kehribar', color: '#f0a020' },
  { id: 'yesim', label: 'Yeşim', color: '#12b981' },
  { id: 'gokyuzu', label: 'Gökyüzü', color: '#3b82f6' },
  { id: 'menekse', label: 'Menekşe', color: '#8b5cf6' },
  { id: 'gul', label: 'Gül', color: '#f43f5e' },
]

export const DEFAULT_ACCENT = 'vermilyon'

/** Detay panelinin yeri. Yerleşim, temadan bağımsız üçüncü bir eksen. */
export const LAYOUTS = [
  { id: 'sag', label: 'Sağda', hint: 'Üç sütun — geniş ekranda varsayılan' },
  {
    id: 'alt',
    label: 'Altta',
    hint: 'Liste tam genişlik, detay altta — uzun başlıklar ve tablo gibi okunur',
  },
] as const

export type LayoutId = (typeof LAYOUTS)[number]['id']
export const DEFAULT_LAYOUT: LayoutId = 'sag'

export const FONTS = [
  { id: 'jakarta', label: 'Plus Jakarta Sans', hint: 'Uygulamayla paketlenir; her makinede aynı' },
  { id: 'sistem', label: 'Sistem', hint: 'macOS SF / Windows Segoe' },
] as const

export type FontId = (typeof FONTS)[number]['id']
export const DEFAULT_FONT: FontId = 'jakarta'
