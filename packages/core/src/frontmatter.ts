import YAML from 'yaml'
import type { EntryFrontmatter } from './types.js'

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n?/

export interface RawDocument {
  data: Record<string, unknown>
  body: string
}

/** `---` bloğunu ayırır. Blok yoksa tüm içerik gövde sayılır. */
export function parseDocument(raw: string): RawDocument {
  // Windows'ta Not Defteri UTF-8 BOM ile kaydeder; BOM'lu dosya `---` ile
  // başlamadığı için kayıt görünmez olurdu.
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1)
  const match = FRONTMATTER_RE.exec(raw)
  if (!match) return { data: {}, body: raw }
  let data: unknown
  try {
    data = YAML.parse(match[1] ?? '')
  } catch {
    // Bozuk YAML kaydı kaybetmez — gövdeyi olduğu gibi döndürürüz, doğrulama
    // katmanı alanların eksik olduğunu bildirir.
    data = {}
  }
  return {
    data: data && typeof data === 'object' ? (data as Record<string, unknown>) : {},
    body: raw.slice(match[0].length),
  }
}

/**
 * Alan sırası sabit — böylece bir kaydı düzenlemek git diff'inde yalnız
 * gerçekten değişen satırları gösterir.
 */
export const KEY_ORDER: Array<keyof EntryFrontmatter> = [
  'id',
  'title',
  'type',
  'severity',
  'status',
  'occurred_at',
  'created_at',
  'updated_at',
  'project',
  'area',
  'tags',
  'refs',
  'status_since',
  'next_action',
  'next_review',
  'pinned',
]

function isEmpty(value: unknown): boolean {
  if (value === undefined || value === null || value === '') return true
  if (Array.isArray(value)) return value.length === 0
  if (typeof value === 'object') return Object.keys(value as object).every((k) => isEmpty((value as Record<string, unknown>)[k]))
  return false
}

/**
 * `extra`: şemanın tanımadığı ama dosyada duran alanlar. Bilinen bir anahtarı
 * da ezebilir (okurken güvenli karşılığa çekilmiş bir enum'un asıl değeri) —
 * daha yeni bir devlog'un yazdığı bir şeyi eski bir araç sessizce silmesin.
 */
export function serializeDocument(
  frontmatter: EntryFrontmatter,
  body: string,
  extra: Record<string, unknown> = {},
): string {
  const source: Record<string, unknown> = { ...frontmatter, ...extra }
  const ordered: Record<string, unknown> = {}
  for (const key of KEY_ORDER) {
    const value = source[key]
    if (isEmpty(value)) continue
    if (key === 'refs' && value && typeof value === 'object') {
      const refs: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        if (!isEmpty(v)) refs[k] = v
      }
      ordered[key] = refs
      continue
    }
    ordered[key] = value
  }
  for (const [key, value] of Object.entries(extra)) {
    if (!(KEY_ORDER as string[]).includes(key) && value !== undefined) ordered[key] = value
  }
  const yaml = YAML.stringify(ordered, { lineWidth: 0 })
  return `---\n${yaml}---\n\n${body.trim()}\n`
}

const WIKILINK_RE = /\[\[([^\]|]+?)(?:\|[^\]]*)?\]\]/g

/** Fenced blok ve satır içi kod aralıkları — yakalama grubu split'te korunur. */
const CODE_REGION_RE = /(```[\s\S]*?```|~~~[\s\S]*?~~~|`+[^`\n]*`+)/g

/**
 * Dönüşümü yalnız kod bölgelerinin DIŞINA uygular; kod verbatim kalır.
 *
 * Kural: kodun içindeki `[[şey]]` bir bağlantı değildir. Hem işleme hem
 * backlink çıkarımı bu kuralı paylaşmalı — yoksa "Buraya bağlananlar"da
 * görünen ama gövdede tıklanamayan hayalet bağlantılar oluşur.
 */
export function mapOutsideCode(text: string, transform: (chunk: string) => string): string {
  return text
    .split(CODE_REGION_RE)
    .map((part, index) => (index % 2 === 1 ? part : transform(part)))
    .join('')
}

/** Gövdedeki `[[hedef]]` bağlantılarını çıkarır. Backlink indeksi bunu kullanır. */
export function extractWikilinks(text: string): string[] {
  const found = new Set<string>()
  mapOutsideCode(text, (chunk) => {
    for (const match of chunk.matchAll(WIKILINK_RE)) {
      const target = match[1]?.trim()
      if (target) found.add(target)
    }
    return chunk
  })
  return [...found]
}
