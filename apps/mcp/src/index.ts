import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  ENTRY_TYPES,
  SEVERITIES,
  STATUSES,
  createEntry,
  localDayKey,
  localIso,
  openIndex,
  redact,
  trackEntry,
  trackingState,
  writeEntry,
} from '@devlog/core'
import type { Entry, EntrySummary, MiniSearchIndex, QueryFilter } from '@devlog/core'
import { z } from 'zod'

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/

/**
 * devlog MCP sunucusu — Claude Code'un herhangi bir projeden seyir defterine
 * yazmasını ve sorgulamasını sağlar.
 *
 * KRİTİK: stdout JSON-RPC kanalıdır. Buraya tek bir `console.log` bile
 * protokolü bozar; her türlü teşhis çıktısı stderr'e gider.
 */

const CACHE_TTL_MS = 2_000
let cache: { at: number; index: MiniSearchIndex; vaultRoot: string } | null = null

/**
 * İndeks süreç başına bir kez değil, kısa TTL'le tazelenir. Sebep: masaüstü
 * uygulaması ve hook'lar aynı vault'a yazıyor; uzun ömürlü bir sunucuda tek
 * seferlik okuma, sonradan eklenen kayıtları görünmez yapardı.
 */
async function getIndex(): Promise<{ index: MiniSearchIndex; vaultRoot: string }> {
  const now = Date.now()
  if (cache && now - cache.at < CACHE_TTL_MS) return cache
  const { index, config } = await openIndex()
  cache = { at: now, index, vaultRoot: config.vaultRoot }
  return cache
}

function invalidate(): void {
  cache = null
}

function toJson(entry: EntrySummary): Record<string, unknown> {
  return {
    id: entry.id,
    title: entry.title,
    type: entry.type,
    severity: entry.severity,
    status: entry.status,
    occurred_at: entry.occurred_at,
    area: entry.area,
    project: entry.project,
    tags: entry.tags,
    source: entry.sourceId,
    read_only: entry.readOnly,
    // Ayna kayıtlarında bu alanlar metinden ÇIKARILMIŞTIR, dosyada yazmaz.
    derived: entry.derived,
    // Kullanıcının (ya da senin) karara bağladığı alanlar — bunlar tahmin değil.
    overridden: entry.overridden,
    next_action: entry.next_action,
    next_review: entry.next_review,
    pinned: entry.pinned,
    status_since: entry.status_since,
    age_days: trackingState(entry).ageDays,
    stale: trackingState(entry).stale,
    excerpt: entry.excerpt,
  }
}

function text(payload: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }] }
}

function errorText(message: string) {
  return { content: [{ type: 'text' as const, text: message }], isError: true }
}

const filterShape = {
  // Biçim zorunlu: `7d` gibi bir değer sessizce boş sonuç döndürüyordu ve ajan
  // bunu "kayıt yok" diye okuyordu.
  since: z.string().regex(DAY_RE, 'YYYY-MM-DD bekleniyor').optional().describe('Başlangıç günü: `YYYY-MM-DD` (dahil)'),
  until: z.string().regex(DAY_RE, 'YYYY-MM-DD bekleniyor').optional().describe('Bitiş günü: `YYYY-MM-DD` (dahil)'),
  type: z.array(z.enum(ENTRY_TYPES)).optional(),
  status: z.array(z.enum(STATUSES)).optional(),
  severity: z.array(z.enum(SEVERITIES)).optional(),
  tag: z.array(z.string()).optional(),
  stale: z
    .boolean()
    .optional()
    .describe('Yalnız bayatlayanlar: aktif durumda ama kendi eşiğini aşmış kayıtlar'),
  limit: z.number().int().min(1).max(200).optional(),
}

type FilterArgs = {
  since?: string
  until?: string
  type?: readonly string[]
  status?: readonly string[]
  severity?: readonly string[]
  tag?: string[]
  stale?: boolean
  limit?: number
}

function buildFilter(args: FilterArgs, query?: string): QueryFilter {
  return {
    text: query,
    from: args.since,
    to: args.until,
    types: args.type as QueryFilter['types'],
    statuses: args.status as QueryFilter['statuses'],
    severities: args.severity as QueryFilter['severities'],
    tags: args.tag,
    stale: args.stale,
    sort: 'newest',
  }
}

/** Salt-okunur aynadaki kayıtlar değiştirilemez — onlar başka bir aracın dosyaları. */
function assertWritable(entry: Entry): void {
  if (entry.readOnly) {
    throw new Error(
      `Bu kayıt salt-okunur bir aynadan geliyor (${entry.sourceId}). ` +
        'Kaynağa yazılmaz; bunun yerine kendi vault\'unda referans veren yeni bir kayıt aç.',
    )
  }
}

const server = new McpServer({ name: 'devlog', version: '0.1.0' })

server.registerTool(
  'devlog_search',
  {
    title: 'Seyir defterinde ara',
    description:
      'Ürün geliştirme seyir defterinde tam metin + filtre araması yapar. Türkçe diakritik ' +
      'katlamalıdır ("sokum" araması "söküm"ü bulur). Yazılabilir vault ve salt-okunur ' +
      'aynaları (Claude memory) birlikte tarar. "Temmuzda CDN tarafında ne oldu" gibi ' +
      'sorularda ilk başvurulacak araç.',
    inputSchema: { query: z.string().optional().describe('Serbest metin'), ...filterShape },
  },
  async (args) => {
    const { index } = await getIndex()
    const result = index.query(buildFilter(args, args.query), args.limit ?? 30)
    return text({ total: result.total, items: result.items.map(toJson) })
  },
)

server.registerTool(
  'devlog_get',
  {
    title: 'Kaydın tamamını getir',
    description: 'Bir kaydın gövdesini, meta alanlarını ve ona bağlanan kayıtları (backlink) döner.',
    inputSchema: { id: z.string().describe('Kaydın id\'si') },
  },
  async ({ id }) => {
    const { index } = await getIndex()
    const entry = index.get(id)
    if (!entry) return errorText(`Kayıt bulunamadı: ${id}`)
    return text({
      ...toJson({ ...entry, excerpt: '' }),
      body: entry.body,
      path: entry.path,
      outbound_links: entry.outboundLinks,
      backlinks: index.backlinks(id).map((b) => ({ id: b.id, title: b.title })),
    })
  },
)

server.registerTool(
  'devlog_create',
  {
    title: 'Yeni kayıt yaz',
    description:
      'Seyir defterine yeni bir kayıt yazar. Kalıcı değeri olan şeyler için kullan: ' +
      'incident, güvenlik bulgusu, verilmiş karar ve gerekçesi, deploy, öğrenilen ders. ' +
      'Rutin dosya düzenlemelerini KAYDETME. `occurred_at` olayın gerçek zamanıdır — ' +
      'geçmişe dönük kayıtta onu olayın zamanına ayarla. Gövdedeki token/anahtar ' +
      'otomatik maskelenir.',
    inputSchema: {
      title: z.string().describe('Tek satır, olayı anlatan başlık'),
      type: z.enum(ENTRY_TYPES),
      body: z.string().describe('Markdown gövde. `[[baska-kayit-id]]` ile bağlantı kurabilirsin.'),
      severity: z.enum(SEVERITIES).optional().describe('incident ve security için ZORUNLU'),
      status: z.enum(STATUSES).optional(),
      area: z.string().optional().describe('Alt sistem: cdn, auth, billing, db…'),
      project: z.string().optional(),
      tags: z.array(z.string()).optional(),
      occurred_at: z.string().optional().describe('ISO zaman; verilmezse şimdi'),
      commits: z.array(z.string()).optional(),
      files: z.array(z.string()).optional(),
      links: z.array(z.string()).optional().describe('İlgili kayıt id\'leri'),
    },
    annotations: { destructiveHint: false, idempotentHint: false },
  },
  async (args) => {
    const { vaultRoot } = await getIndex()
    const masked = redact(args.body)
    const severity =
      args.severity ?? (args.type === 'incident' || args.type === 'security' ? 'medium' : undefined)

    const entry = await createEntry(vaultRoot, {
      title: args.title,
      type: args.type,
      body: masked.text,
      severity,
      status: args.status,
      area: args.area,
      project: args.project,
      tags: args.tags,
      occurred_at: args.occurred_at,
      refs: { commits: args.commits, files: args.files, links: args.links },
    })
    invalidate()
    return text({ id: entry.id, path: entry.path, redacted: masked.found })
  },
)

server.registerTool(
  'devlog_append',
  {
    title: 'Kayda ekle',
    description:
      'Var olan bir kaydın gövdesinin sonuna metin ekler. Bir olay geliştiğinde ' +
      '(fix uygulandı, canlıda doğrulandı) yeni kayıt açmak yerine bunu kullan.',
    inputSchema: { id: z.string(), text: z.string().describe('Eklenecek markdown') },
  },
  async ({ id, text: addition }) => {
    const { index, vaultRoot } = await getIndex()
    const entry = index.get(id)
    if (!entry) return errorText(`Kayıt bulunamadı: ${id}`)
    try {
      assertWritable(entry)
    } catch (error) {
      return errorText(error instanceof Error ? error.message : String(error))
    }

    const masked = redact(addition)
    const { body, path: _p, sourceId: _s, readOnly: _r, derived: _d, outboundLinks: _o, ...frontmatter } = entry
    const written = await writeEntry(
      vaultRoot,
      { ...frontmatter, updated_at: localIso() },
      `${body.trimEnd()}\n\n${masked.text.trim()}`,
      entry.path,
    )
    invalidate()
    return text({ id, path: written, redacted: masked.found })
  },
)

server.registerTool(
  'devlog_update_status',
  {
    title: 'Durumu ve takip alanlarını değiştir',
    description:
      'Bir konunun BUGÜNKÜ hâlini günceller: durum (open → in-progress → ' +
      'monitoring/fixed…), sıradaki adım, gözden geçirme günü. Bir işi bitirdiğinde, ' +
      'bir fix\'i deploy ettiğinde ya da canlıda doğruladığında bunu çağır — kayıt ' +
      'açmaktan daha değerlidir, çünkü "ne duruyor" listesini güncel tutan tek şey budur. ' +
      'Salt-okunur aynalardaki (Claude memory) kayıtlarda da çalışır: değişiklik ' +
      'kaynağa değil, defterdeki takip dosyasına yazılır.',
    inputSchema: {
      id: z.string(),
      status: z.enum(STATUSES).optional(),
      next_action: z.string().optional().describe('Sıradaki somut adım, tek cümle'),
      next_review: z.string().optional().describe('`YYYY-MM-DD` — ne zaman tekrar bakılmalı'),
      status_since: z
        .string()
        .optional()
        .describe(
          'Durum ne zamandan beri böyle. Geçmişte olmuş bir değişikliği şimdi ' +
            'kaydediyorsan ver — bayatlık bu tarihten sayılır.',
        ),
      note: z.string().optional().describe('Kısa gerekçe; kaynağın gövdesine yazılmaz'),
    },
  },
  async ({ id, status, next_action, next_review, note, status_since }) => {
    const { index, vaultRoot } = await getIndex()
    const entry = index.get(id)
    if (!entry) return errorText(`Kayıt bulunamadı: ${id}`)

    const outcome = await trackEntry(
      vaultRoot,
      entry,
      {
        status,
        status_since,
        next_action: next_action === undefined ? undefined : redact(next_action).text,
        next_review,
        note: note === undefined ? undefined : redact(note).text,
      },
      'agent',
    )
    invalidate()
    return text({
      id,
      status: status ?? entry.status,
      target: outcome.target,
      path: outcome.path,
      // Sessizce ezmiyoruz: kullanıcının elle verdiği bir kararı değiştirdiysen
      // bunu ona söylemen gerekir.
      warning: outcome.overwroteUserDecision
        ? 'Bu kaydın durumunu kullanıcı elle ayarlamıştı; değiştirdin. Gerekçeni söyle.'
        : undefined,
    })
  },
)

server.registerTool(
  'devlog_timeline',
  {
    title: 'Bir günün akışı',
    description:
      'Belirli bir güne düşen tüm kayıtları kronolojik döner. "14 Temmuz\'da ne oldu" ' +
      'sorusunun doğrudan cevabı.',
    inputSchema: { day: z.string().optional().describe('`YYYY-MM-DD`; verilmezse bugün') },
  },
  async ({ day }) => {
    const target = day ?? localDayKey(new Date().toISOString())
    const { index } = await getIndex()
    const result = index.query({ from: target, to: target, sort: 'oldest' }, 200)
    return text({ day: target, total: result.total, items: result.items.map(toJson) })
  },
)

const transport = new StdioServerTransport()
await server.connect(transport)
process.stderr.write('[devlog-mcp] hazır\n')
