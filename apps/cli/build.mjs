import { chmodSync } from 'node:fs'
import { build } from 'esbuild'

/**
 * Tek dosyaya bundle ediyoruz çünkü bu ikiliyi Claude Code hook'ları çağıracak:
 * hook'lar her tool çağrısında/oturum sonunda çalışır, `tsx` gibi bir çalışma
 * zamanı yükleyicisinin başlangıç maliyeti orada doğrudan gecikmeye dönüşür.
 */
await build({
  entryPoints: {
    devlog: 'src/index.ts',
    'hook-tool-use': 'src/hooks/on-tool-use.ts',
    'hook-session-end': 'src/hooks/on-session-end.ts',
  },
  outdir: 'dist',
  outExtension: { '.js': '.mjs' },
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  banner: {
    // Bağımlılıklardan bazıları (yaml) CJS yayımlıyor; esbuild bunları ESM'e
    // sararken `__require` shim'i üretiyor ve o shim node yerleşiklerinde
    // patlıyor ("Dynamic require of \"process\" is not supported"). Gerçek
    // `require`ı tanımlamak shim'i çalışır hâle getiriyor.
    js: [
      '#!/usr/bin/env node',
      "import { createRequire as __devlogCreateRequire } from 'node:module'",
      'const require = __devlogCreateRequire(import.meta.url)',
    ].join('\n'),
  },
  logLevel: 'info',
})

for (const name of ['devlog', 'hook-tool-use', 'hook-session-end']) {
  chmodSync(`dist/${name}.mjs`, 0o755)
}
