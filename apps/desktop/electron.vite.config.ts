import { resolve } from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'electron-vite'

// Ana süreç ve preload Vite'ın SSR ortamında derleniyor ve SSR varsayılanı
// `dependencies`i DIŞSALLAŞTIRMAK. `@devlog/core` derlenmemiş TS kaynağı
// yayımlıyor — dışsal kalırsa Electron'un Node'u `.js` arayıp patlıyor.
// Çözüm: paket `devDependencies`te durur, böylece bundle edilir (bkz.
// package.json). `ssr.noExternal: true` DENENMEMELİ — `electron`ı da bundle
// edip npm shim'ini (bir yol dizesi) yükler ve `electron.app` undefined olur.
export default defineConfig({
  main: {
    build: {
      rollupOptions: { input: { index: resolve('src/main/index.ts') } },
    },
  },
  preload: {
    build: {
      rollupOptions: { input: { index: resolve('src/preload/index.ts') } },
    },
  },
  renderer: {
    root: 'src/renderer',
    resolve: {
      alias: { '@': resolve('src/renderer/src') },
    },
    plugins: [react(), tailwindcss()],
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/renderer/index.html'),
          capture: resolve('src/renderer/capture.html'),
        },
      },
    },
  },
})
