import { loadConfig as loadSharedConfig, saveConfig, type DevlogConfig } from '@devlog/core'

/**
 * Yapılandırma artık `@devlog/core` üzerinden `~/.devlog/config.json`'dan gelir
 * — Electron'un platforma özel userData dizininden DEĞİL. Sebep: `devlog` CLI'ı,
 * MCP sunucusu ve Claude Code hook'ları aynı vault'u bulmak zorunda.
 */
export type AppConfig = DevlogConfig & { hotkey: string }

/**
 * Windows'ta `Alt+Space` sistem pencere menüsünü açar; o platformda
 * `Ctrl+Alt+Space`'e düşüyoruz.
 */
export const DEFAULT_HOTKEY = process.platform === 'darwin' ? 'Alt+Space' : 'Control+Alt+Space'

export async function loadAppConfig(): Promise<AppConfig> {
  const config = await loadSharedConfig()
  return { ...config, hotkey: config.hotkey ?? DEFAULT_HOTKEY }
}

export async function saveAppConfig(config: AppConfig): Promise<void> {
  await saveConfig(config)
}
