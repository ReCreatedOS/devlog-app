import { useEffect } from 'react'
import { DEFAULT_ACCENT, DEFAULT_THEME, themeInfo } from '@devlog/core/shared'
import type { AppSettings } from '../../../shared/ipc.js'

/**
 * Temayı `<html>` üzerindeki veri özniteliklerine uygular.
 *
 * `data-theme` nötr rampayı, `data-accent` vurgu rengini seçer; ikisi bağımsız
 * eksen. `.dark` / `.light` sınıfları da korunur — şemaya bağlı üçüncü taraf
 * bileşenler (CodeMirror gibi) onlara bakabilir.
 *
 * `system`: işletim sistemi koyu/açık kararını izler ve o şemanın varsayılan
 * temasına düşer. Canlı dinlenir, uygulamayı yeniden başlatmak gerekmez.
 */
export function applyTheme(
  theme: AppSettings['theme'] | undefined,
  accent: string | undefined,
  font?: string,
): () => void {
  const media = window.matchMedia('(prefers-color-scheme: dark)')

  const apply = (): void => {
    const resolved =
      !theme || theme === 'system' ? (media.matches ? DEFAULT_THEME : 'gun') : theme
    const info = themeInfo(resolved)
    const root = document.documentElement
    root.dataset.theme = info.id
    root.dataset.accent = accent ?? DEFAULT_ACCENT
    root.dataset.font = font ?? 'jakarta'
    root.classList.toggle('dark', info.scheme === 'dark')
    root.classList.toggle('light', info.scheme === 'light')
    // Pencere arkaplanı da tema ile değişsin: yeniden boyutlarken kenarlarda
    // eski rengin şeridi görünmesin.
    root.style.colorScheme = info.scheme
  }

  apply()
  if (theme && theme !== 'system') return () => undefined
  media.addEventListener('change', apply)
  return () => media.removeEventListener('change', apply)
}

export function useTheme(
  theme: AppSettings['theme'] | undefined,
  accent?: string,
  font?: string,
): void {
  useEffect(() => applyTheme(theme, accent, font), [theme, accent, font])
}
