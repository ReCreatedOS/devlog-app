/**
 * Uygulama ikonunu üretir: `build/icon.png` (1024×1024 RGBA).
 *
 * Neden elle: bu makinede SVG→PNG dönüştürücü yok (rsvg/imagemagick/inkscape),
 * ve tek bir ikon için görüntü kütüphanesi bağımlılığı taşımaya değmez. Node'un
 * yerleşik zlib'i PNG yazmaya yetiyor.
 *
 * Çizim 2× çözünürlükte yapılıp yarıya indiriliyor — kenar yumuşatma bundan.
 *
 *   node build/make-icon.mjs
 */
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT_SIZE = 1024
const SS = 2 // supersampling
const N = OUT_SIZE * SS

// ── PNG yazıcı ────────────────────────────────────────────────────────────────
const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

function crc32(buf) {
  let c = -1
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}

function chunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(typeAndData))
  return Buffer.concat([length, typeAndData, crc])
}

function encodePng(rgba, size) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  // 10..12 = compression / filter / interlace = 0

  // Her tarama satırının başına filtre baytı (0 = None).
  const raw = Buffer.alloc((size * 4 + 1) * size)
  for (let y = 0; y < size; y += 1) {
    raw[y * (size * 4 + 1)] = 0
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4)
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

// ── Çizim ─────────────────────────────────────────────────────────────────────
const buf = Buffer.alloc(N * N * 4) // saydam

function put(x, y, [r, g, b], alpha) {
  if (alpha <= 0 || x < 0 || y < 0 || x >= N || y >= N) return
  const i = (y * N + x) * 4
  const a = Math.min(1, alpha)
  // Var olan pikselin üstüne "source-over" karışım.
  const dstA = buf[i + 3] / 255
  const outA = a + dstA * (1 - a)
  if (outA === 0) return
  buf[i] = Math.round((r * a + buf[i] * dstA * (1 - a)) / outA)
  buf[i + 1] = Math.round((g * a + buf[i + 1] * dstA * (1 - a)) / outA)
  buf[i + 2] = Math.round((b * a + buf[i + 2] * dstA * (1 - a)) / outA)
  buf[i + 3] = Math.round(outA * 255)
}

const lerp = (a, b, t) => a + (b - a) * t
const mix = (c1, c2, t) => [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)]

/** Apple squircle'a yakın süperelips: |dx|^n + |dy|^n <= 1 */
function squircleAlpha(x, y, cx, cy, half, n) {
  const dx = Math.abs((x - cx) / half)
  const dy = Math.abs((y - cy) / half)
  return dx ** n + dy ** n <= 1 ? 1 : 0
}

function roundedBar(x, y, x0, y0, x1, y1, radius) {
  if (x < x0 - radius || x > x1 + radius || y < y0 || y > y1) return 0
  const cx = Math.min(Math.max(x, x0), x1)
  const dist = Math.hypot(x - cx, 0)
  return dist <= radius ? 1 : 0
}

const INSET = 0.085 * N
const HALF = (N - INSET * 2) / 2
const CX = N / 2
const CY = N / 2

const TOP = [0x25, 0x26, 0x2c]
const BOTTOM = [0x0a, 0x0b, 0x0e]
const VERMILLION = [0xff, 0x5a, 0x1f]
const AMBER = [0xfb, 0xbf, 0x24]
const SLATE = [0x8a, 0x8f, 0x98]
const BAR = [0x3a, 0x3c, 0x44]

// 1) Gövde: dikey gradyanlı squircle
for (let y = 0; y < N; y += 1) {
  const t = (y - INSET) / (N - INSET * 2)
  const color = mix(TOP, BOTTOM, Math.min(1, Math.max(0, t)))
  for (let x = 0; x < N; x += 1) {
    if (squircleAlpha(x, y, CX, CY, HALF, 5)) put(x, y, color, 1)
  }
}

// 2) Üst kenarda ince ışık çizgisi (Linear "sheen")
for (let y = 0; y < N; y += 1) {
  for (let x = 0; x < N; x += 1) {
    const inside = squircleAlpha(x, y, CX, CY, HALF, 5)
    const insideInner = squircleAlpha(x, y, CX, CY, HALF - N * 0.004, 5)
    if (inside && !insideInner && y < CY) {
      put(x, y, [0xff, 0xff, 0xff], 0.16 * (1 - (y - INSET) / HALF))
    }
  }
}

// 3) Üç "log satırı": solda severity noktası, sağında çubuk.
//    Uygulamanın liste satırı anatomisinin küçültülmüş hâli.
const ROWS = [
  { y: 0.375, dot: VERMILLION, bar: [0xd8, 0xdb, 0xe2], width: 0.46 },
  { y: 0.5, dot: AMBER, bar: BAR, width: 0.38 },
  { y: 0.625, dot: SLATE, bar: BAR, width: 0.3 },
]
const DOT_X = 0.315 * N
const DOT_R = 0.032 * N
const BAR_X0 = 0.395 * N
const BAR_H = 0.038 * N

// 3a) Zaman ekseni: noktaları birleştiren dikey omurga. Uygulama içindeki
//     marka (renderer/src/components/Logo.tsx) ile aynı anatomi — ikon ve
//     arayüz aynı şeyi söylesin.
const SPINE_W = N * 0.007
for (let y = Math.floor(ROWS[0].y * N); y <= Math.ceil(ROWS[ROWS.length - 1].y * N); y += 1) {
  for (let x = Math.floor(DOT_X - SPINE_W); x <= Math.ceil(DOT_X + SPINE_W); x += 1) {
    put(x, y, SLATE, 0.35)
  }
}

for (const row of ROWS) {
  const cy = row.y * N
  for (let y = Math.floor(cy - DOT_R - 2); y <= Math.ceil(cy + DOT_R + 2); y += 1) {
    for (let x = Math.floor(DOT_X - DOT_R - 2); x <= Math.ceil(DOT_X + DOT_R + 2); x += 1) {
      if (Math.hypot(x - DOT_X, y - cy) <= DOT_R) put(x, y, row.dot, 1)
    }
  }
  const x1 = BAR_X0 + row.width * N
  for (let y = Math.floor(cy - BAR_H / 2); y <= Math.ceil(cy + BAR_H / 2); y += 1) {
    for (let x = Math.floor(BAR_X0 - BAR_H); x <= Math.ceil(x1 + BAR_H); x += 1) {
      if (roundedBar(x, y, BAR_X0, cy - BAR_H / 2, x1, cy + BAR_H / 2, BAR_H / 2)) {
        put(x, y, row.bar, 1)
      }
    }
  }
}

// ── Yarıya indir (kenar yumuşatma) ────────────────────────────────────────────
const out = Buffer.alloc(OUT_SIZE * OUT_SIZE * 4)
for (let y = 0; y < OUT_SIZE; y += 1) {
  for (let x = 0; x < OUT_SIZE; x += 1) {
    let r = 0
    let g = 0
    let b = 0
    let a = 0
    for (let dy = 0; dy < SS; dy += 1) {
      for (let dx = 0; dx < SS; dx += 1) {
        const i = ((y * SS + dy) * N + (x * SS + dx)) * 4
        const pa = buf[i + 3] / 255
        r += buf[i] * pa
        g += buf[i + 1] * pa
        b += buf[i + 2] * pa
        a += pa
      }
    }
    const i = (y * OUT_SIZE + x) * 4
    if (a > 0) {
      out[i] = Math.round(r / a)
      out[i + 1] = Math.round(g / a)
      out[i + 2] = Math.round(b / a)
    }
    out[i + 3] = Math.round((a / (SS * SS)) * 255)
  }
}

const dir = dirname(fileURLToPath(import.meta.url))
mkdirSync(dir, { recursive: true })
const target = join(dir, 'icon.png')
writeFileSync(target, encodePng(out, OUT_SIZE))
console.log(`icon yazıldı: ${target} (${OUT_SIZE}×${OUT_SIZE})`)
