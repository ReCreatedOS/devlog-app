import { chmodSync } from 'node:fs'
import { build } from 'esbuild'

await build({
  entryPoints: ['src/index.ts'],
  outfile: 'dist/devlog-mcp.mjs',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  banner: {
    // CJS bağımlılıkları ESM'e sarılırken üretilen `__require` shim'i node
    // yerleşiklerinde patlıyor; gerçek `require`ı tanımlamak onu kurtarır.
    js: [
      '#!/usr/bin/env node',
      "import { createRequire as __devlogCreateRequire } from 'node:module'",
      'const require = __devlogCreateRequire(import.meta.url)',
    ].join('\n'),
  },
  logLevel: 'info',
})

chmodSync('dist/devlog-mcp.mjs', 0o755)
