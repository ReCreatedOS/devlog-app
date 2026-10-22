import { promises as fs } from 'node:fs'
import path from 'node:path'
import { localIso, toEntry } from '../entry.js'
import { parseDocument } from '../frontmatter.js'
import { listMarkdownFiles } from '../vault.js'
import type { Entry, EntryFrontmatter, EntryStatus, EntryType, Severity, SourceInfo } from '../types.js'

/**
 * Claude Code memory klasörü için **salt-okunur** adaptör.
 *
 * Bu dosyalar başka bir aracın (Claude'un) yazdığı dosyalardır. Buradaki her şey
 * ÇIKARIM'dır — kaynağa tek bir bayt yazılmaz, böylece Claude ile dosya kavgası
 * olmaz. Çıkarılan alanlar `derived` listesinde işaretlenir ve UI bunları
 * "tahmin" olarak gösterir.
 *
 * Kaynak biçimi:
 *   ---
 *   name: login-rate-limit-bypass
 *   description: "..."
 *   metadata:
 *     node_type: memory
 *     type: project
 *     modified: 2026-07-30T14:27:02.525Z
 *   ---
 *   Türkçe gövde, durum emoji + serbest metinle kodlanmış.
 */

/** Bu klasördeki index dosyası kayıt değil, içindekiler listesidir. */
const SKIP_FILES = new Set(['MEMORY.md'])

const ISO_DAY_RE = /(\d{4}-\d{2}-\d{2})/

/**
 * Durum çıkarımı. **Sıra önemli:** "CANLI DOĞRULANDI ... fix uygulanmadı" gibi
 * bir gövde `open` olmalı — açık bulgunun canlı doğrulanmış olması onu
 * düzeltilmiş yapmaz.
 */
const STATUS_RULES: Array<{ status: EntryStatus; patterns: RegExp[] }> = [
  { status: 'monitoring', patterns: [/İZLEMEDE/i, /📌/] },
  { status: 'blocked', patterns: [/onay(?:ı|ini|ını)? bekl[ıi]yor/i, /askıya alındı/i, /ertelendi/i] },
  {
    status: 'open',
    patterns: [
      /fix uygulanmad[ıi]/i,
      /deploy ed[ıi]lmem[ıi]ş/i,
      /deploy bekl[ıi]yor/i,
      /UNFIXED/i,
      /EKS[İIı]K fix/i,
      /fix yok/i,
    ],
  },
  {
    status: 'fixed',
    // Çıplak ✅ bilinçli olarak YOK: herhangi bir yapılacaklar listesindeki tek
    // işaret tüm notu `fixed` yapıyordu.
    patterns: [/FIXLEND[İIı]/i, /FIX UYGULANDI/i, /✅\s*FIX/i, /FIXLENMI[Şş]/i],
  },
  { status: 'verified', patterns: [/CANLI DOĞRULANDI/i, /DOĞRULANDI/i] },
]

/**
 * `wontfix` bilinçli olarak ÇIKARILMAZ.
 *
 * "SÖMÜRÜLEMEZ", "kapsam dışı" gibi ifadeler çok bulgulu bir kayıtta tek bir alt
 * maddeye ait olabiliyor; bir eşleşme tüm kaydı çalışma kümesinden sessizce
 * silerdi. Bir şeyin yapılmayacağı bir KARARDIR — insan ya da ajan atar,
 * regex değil.
 */

/**
 * Yarım kalmışlık işaretleri. `open` sinyaliyle BİRLİKTE görünürlerse durum
 * `in-progress` olur: iş başlamış ama bitmemiştir.
 *
 * Bu ayrım pratikte en sık karşılaşılan hâl — "test veritabanında doğrulandı,
 * prod deploy bekliyor" bir açık bulgu kadar kötü değil, kapanmış bir iş kadar
 * da iyi değil. İkisinden birine yuvarlamak listeyi yalancı yapıyordu.
 */
const PROGRESS_PATTERNS = [
  /kod-tamam/i,
  /commit bekl[ıi]yor/i,
  /kısmen/i,
  /yarım kapatıldı/i,
  /test'?te (?:uygulandı|doğrulandı|deploy)/i,
  /Faz\s*\d+\s*(?:TAMAM|bitti)/i,
  /PROD(?:'a| deploy)? bekl[ıi]yor/i,
]

// Kelime sınırı şart: yoksa "highlight" high, "criticality" critical sayılıyordu.
const CRITICAL_PATTERNS = [/🔴/, /\bKR[İIı]T[İIı]K\b/i, /\bCRITICAL\b/i]
const HIGH_PATTERNS = [/⚠️?/, /\bYÜKSEK\b/i, /\bHIGH\b/i]

function inferType(stem: string): EntryType {
  if (/^vuln/i.test(stem) || /^security/i.test(stem) || /^bulgu/i.test(stem)) return 'security'
  if (/^feedback/i.test(stem)) return 'note'
  if (/-plan$/i.test(stem) || /-plan-/i.test(stem)) return 'decision'
  if (/incident/i.test(stem)) return 'incident'
  return 'note'
}

function inferSeverity(body: string, type: EntryType): Severity | undefined {
  if (CRITICAL_PATTERNS.some((re) => re.test(body))) return 'critical'
  if (HIGH_PATTERNS.some((re) => re.test(body))) return 'high'
  // Şema `security` için severity zorunlu tutuyor; sinyal yoksa en muhafazakâr
  // varsayım `medium`.
  return type === 'security' || type === 'incident' ? 'medium' : undefined
}

function matchStatus(text: string): EntryStatus | undefined {
  for (const rule of STATUS_RULES) {
    if (!rule.patterns.some((re) => re.test(text))) continue
    if (rule.status === 'open' && PROGRESS_PATTERNS.some((re) => re.test(text))) {
      return 'in-progress'
    }
    return rule.status
  }
  return undefined
}

/**
 * Kapsama sırası: gövde → `description`.
 *
 * Bu dosyalarda durum bazen yalnız başlıkta yazıyor ("… ✅ FIXLENDİ, prod'da
 * doğrulandı") ve gövde sessiz kalıyor; yalnız gövdeye bakmak o kayıtları
 * durumsuz bırakıyordu. İkisini BİRLEŞTİRİP tek metinde aramıyoruz — çelişme
 * ihtimali gerçek, gövde daha ayrıntılı olduğu için o kazanır.
 */
function inferStatus(body: string, description?: string): EntryStatus | undefined {
  return matchStatus(body) ?? (description ? matchStatus(description) : undefined)
}

/** `-Users-alice-code-MyApp` → `myapp` */
function inferProject(root: string): string | undefined {
  const encoded = path.basename(path.dirname(root))
  const last = encoded.split('-').filter(Boolean).at(-1)
  return last ? last.toLowerCase() : undefined
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

export async function readClaudeMemoryFile(
  absPath: string,
  source: SourceInfo,
): Promise<Entry | null> {
  let raw: string
  let mtime: Date
  try {
    ;[raw, mtime] = await Promise.all([
      fs.readFile(absPath, 'utf8'),
      fs.stat(absPath).then((s) => s.mtime),
    ])
  } catch {
    return null
  }

  const { data, body } = parseDocument(raw)
  const metadata = asRecord(data.metadata)
  const stem = path.basename(absPath, '.md')

  const id = typeof data.name === 'string' && data.name.trim() ? data.name.trim() : stem
  const title =
    typeof data.description === 'string' && data.description.trim()
      ? data.description.trim()
      : stem

  const type = inferType(stem)
  const severity = inferSeverity(body, type)
  const status = inferStatus(body, typeof data.description === 'string' ? data.description : undefined)

  const modified = typeof metadata.modified === 'string' ? metadata.modified : undefined
  const bodyDay = ISO_DAY_RE.exec(body)?.[1]
  // Gövdedeki ilk tarih olayın tarihidir; yoksa dosyanın son değişim zamanı.
  const occurredAt = bodyDay ? `${bodyDay}T12:00:00` : (modified ?? localIso(mtime))
  const updatedAt = modified ?? localIso(mtime)

  // Yalnız gerçekten çıkarılan alanlar işaretlenir: durum bulunamadıysa UI
  // "status tahmin edildi" demesin, hiçbir şey demesin.
  const derived = ['type', 'occurred_at']
  if (status) derived.push('status')
  if (severity) derived.push('severity')

  const frontmatter: EntryFrontmatter = {
    id,
    title,
    type,
    severity,
    status,
    occurred_at: occurredAt,
    created_at: occurredAt,
    updated_at: updatedAt,
    project: inferProject(source.root),
  }

  return toEntry(frontmatter, body, absPath, {
    sourceId: source.id,
    readOnly: true,
    derived,
  })
}

export async function loadClaudeMemorySource(source: SourceInfo): Promise<Entry[]> {
  const files = await listMarkdownFiles(source.root, (name) => SKIP_FILES.has(name))
  const entries = await Promise.all(files.map((file) => readClaudeMemoryFile(file, source)))
  return entries.filter((entry): entry is Entry => entry !== null)
}
