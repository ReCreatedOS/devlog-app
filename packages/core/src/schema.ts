import { z } from 'zod'
import { ENTRY_TYPES, SEVERITIES, SEVERITY_REQUIRED_TYPES, STATUSES } from './types.js'
import type { EntryFrontmatter } from './types.js'

const isoish = z
  .string()
  .refine((v) => !Number.isNaN(Date.parse(v)), { message: 'geçerli bir tarih değil' })

/** `YYYY-MM-DD`. Gözden geçirme günü saat taşımaz — gün karşılaştırması yapılır. */
const dayKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD bekleniyor')

export const refsSchema = z
  .object({
    commits: z.array(z.string()).optional(),
    files: z.array(z.string()).optional(),
    links: z.array(z.string()).optional(),
    urls: z.array(z.string()).optional(),
  })
  .strict()

/**
 * Frontmatter kontratı. CLI, MCP sunucusu ve UI aynı doğrulayıcıyı çağırır —
 * sözlük tek yerden gelir.
 */
export const frontmatterSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    type: z.enum(ENTRY_TYPES),
    severity: z.enum(SEVERITIES).optional(),
    status: z.enum(STATUSES).optional(),
    occurred_at: isoish,
    created_at: isoish,
    updated_at: isoish.optional(),
    author: z.string().min(1).optional(),
    project: z.string().optional(),
    area: z.string().optional(),
    tags: z.array(z.string()).optional(),
    refs: refsSchema.optional(),
    status_since: isoish.optional(),
    next_action: z.string().optional(),
    next_review: dayKey.optional(),
    pinned: z.boolean().optional(),
  })
  .superRefine((value, ctx) => {
    if (SEVERITY_REQUIRED_TYPES.includes(value.type) && !value.severity) {
      ctx.addIssue({
        code: 'custom',
        path: ['severity'],
        message: `'${value.type}' türü için severity zorunlu`,
      })
    }
  })

export type ParsedFrontmatter = z.infer<typeof frontmatterSchema>

export interface ValidationResult {
  ok: boolean
  value?: EntryFrontmatter
  errors: string[]
}

export interface CoercedFrontmatter {
  value: EntryFrontmatter
  /** Dosyadaki değeri tanınmadığı için değiştirilen alanlar. */
  coerced: string[]
}

/**
 * OKUMA yolu için hoşgörülü ayrıştırma. Yazma yolu (`validateFrontmatter`)
 * katı kalır.
 *
 * Neden: vault kalıcı artefakt, araçlar (uygulama, CLI, MCP) farklı zamanlarda
 * derleniyor. Taksonomiye yeni bir tür eklendiğinde, henüz yeniden derlenmemiş
 * bir araç o kayıtları şemaya uymuyor diye TAMAMEN düşürüyordu — kullanıcıya
 * hiçbir uyarı vermeden. Canlı yaşandı: `commit` türü eklendikten sonra MCP
 * sunucusu 4 kaydı görmedi.
 *
 * Kural: tanınmayan enum değerleri en yakın güvenli karşılığa çekilir ve
 * `coerced` ile işaretlenir; zorunlu alanlar eksikse kayıt yine reddedilir.
 */
export function coerceFrontmatter(data: unknown): CoercedFrontmatter | null {
  if (!data || typeof data !== 'object') return null
  const record = { ...(data as Record<string, unknown>) }
  const coerced: string[] = []

  if (typeof record.type === 'string' && !(ENTRY_TYPES as readonly string[]).includes(record.type)) {
    record.type = 'note'
    coerced.push('type')
  }
  if (
    typeof record.status === 'string' &&
    !(STATUSES as readonly string[]).includes(record.status)
  ) {
    delete record.status
    coerced.push('status')
  }
  if (
    typeof record.severity === 'string' &&
    !(SEVERITIES as readonly string[]).includes(record.severity)
  ) {
    delete record.severity
    coerced.push('severity')
  }
  // Tanınmayan severity silindiyse şemanın zorunluluğu karşılanmalı.
  if (
    typeof record.type === 'string' &&
    SEVERITY_REQUIRED_TYPES.includes(record.type as EntryFrontmatter['type']) &&
    record.severity === undefined
  ) {
    record.severity = 'medium'
    if (!coerced.includes('severity')) coerced.push('severity')
  }

  if (coerced.length === 0) return null
  const parsed = frontmatterSchema.safeParse(record)
  return parsed.success ? { value: parsed.data, coerced } : null
}

export function validateFrontmatter(data: unknown): ValidationResult {
  const parsed = frontmatterSchema.safeParse(data)
  if (parsed.success) return { ok: true, value: parsed.data, errors: [] }
  return {
    ok: false,
    errors: parsed.error.issues.map((i) => `${i.path.join('.') || '(kök)'}: ${i.message}`),
  }
}
