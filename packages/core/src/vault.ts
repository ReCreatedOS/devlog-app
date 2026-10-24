import { promises as fs, type Dirent } from 'node:fs'
import path from 'node:path'
import { entryRelativePath, localIso, makeEntryId, toEntry } from './entry.js'
import { KEY_ORDER, parseDocument, serializeDocument } from './frontmatter.js'
import { redact } from './redact.js'
import { coerceFrontmatter, validateFrontmatter } from './schema.js'
import { TAXONOMY_YAML } from './taxonomy.js'
import { ENTRY_TYPES, SEVERITIES, STATUSES } from './types.js'
import type { Entry, EntryDraft, EntryFrontmatter, SourceInfo } from './types.js'

export interface ReadOptions {
  sourceId: string
  readOnly: boolean
  /** Takım kaynağında benim yazar adım; başkasının kaydı salt-okunur okunur. */
  owner?: string
}

/** Bir kaynaktan okurken kullanılacak seçenekler — tek yerden. */
export function entryOptions(source: SourceInfo): ReadOptions {
  return { sourceId: source.id, readOnly: source.readOnly, owner: source.owner }
}

function originFor(value: EntryFrontmatter, options: ReadOptions): ReadOptions {
  const foreign = options.owner !== undefined && value.author !== options.owner
  return { ...options, readOnly: options.readOnly || foreign }
}

export interface ReadFailure {
  path: string
  errors: string[]
}

export type ReadOutcome = { ok: true; entry: Entry } | { ok: false; failure: ReadFailure }

/** Bizim şemamızdaki bir dosyayı okur ve doğrular. */
export async function readEntryFile(absPath: string, options: ReadOptions): Promise<ReadOutcome> {
  const raw = await fs.readFile(absPath, 'utf8')
  const { data, body } = parseDocument(raw)
  const result = validateFrontmatter(data)
  if (result.ok && result.value) {
    return { ok: true, entry: toEntry(result.value, body, absPath, originFor(result.value, options)) }
  }

  // Katı doğrulama düştüyse, yalnız tanınmayan enum değerleri yüzünden mi
  // düştüğüne bakıyoruz: öyleyse kaydı düşürmek yerine kurtarıyoruz. Vault
  // araçlardan uzun yaşar; daha yeni bir devlog'un yazdığı kayıt, henüz
  // güncellenmemiş bir araçta GÖRÜNMEZ olmamalı.
  const lenient = coerceFrontmatter(data)
  if (lenient) {
    return {
      ok: true,
      entry: toEntry(lenient.value, body, absPath, {
        ...originFor(lenient.value, options),
        coerced: lenient.coerced,
      }),
    }
  }
  return { ok: false, failure: { path: absPath, errors: result.errors } }
}

/** Bir kökteki tüm `.md` dosyalarını toplar. */
export async function listMarkdownFiles(
  root: string,
  skip: (name: string) => boolean = () => false,
): Promise<string[]> {
  const found: string[] = []
  async function walk(dir: string): Promise<void> {
    // `Awaited<ReturnType<typeof fs.readdir>>` Buffer aşırı yüklemesine düşüyor;
    // withFileTypes karşılığını açıkça yazıyoruz.
    let items: Dirent[]
    try {
      items = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const item of items) {
      if (item.name.startsWith('.') || item.name === 'node_modules') continue
      const full = path.join(dir, item.name)
      if (item.isDirectory()) {
        await walk(full)
      } else if (item.isFile() && item.name.endsWith('.md') && !skip(item.name)) {
        found.push(full)
      }
    }
  }
  await walk(root)
  return found.sort()
}

/**
 * Atomik yazma: geçici dosyaya yaz, sonra rename. Yarım yazılmış bir kayıt asla
 * diskte kalmaz — ajan ve uygulama aynı anda yazsa bile izleyici tam dosya görür.
 */
export async function writeFileAtomic(absPath: string, contents: string): Promise<void> {
  await fs.mkdir(path.dirname(absPath), { recursive: true })
  const tmp = `${absPath}.tmp-${process.pid}-${Date.now()}`
  await fs.writeFile(tmp, contents, 'utf8')
  // Windows'ta hedef dosya o an bir izleyici ya da antivirüs tarafından açıksa
  // rename EPERM/EBUSY ile düşer; kısa aralıklarla birkaç kez yeniden dene.
  for (let attempt = 0; ; attempt += 1) {
    try {
      await fs.rename(tmp, absPath)
      return
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (attempt >= 5 || (code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES')) {
        await fs.rm(tmp, { force: true })
        throw error
      }
      await new Promise((resolve) => setTimeout(resolve, 50 * (attempt + 1)))
    }
  }
}

/**
 * Diskteki dosyada olup bizim yazmayacağımız alanlar.
 *
 * İki sınıf: şemanın hiç tanımadığı anahtarlar (elle eklenmiş ya da daha yeni
 * bir devlog'un yazdığı) ve okurken güvenli karşılığa çekilmiş enum değerleri
 * (`type: retro` → `note`). Yazan taraf o alanı bilinçli değiştirmediyse dosyadaki
 * asıl değer korunur; yoksa her append/durum değişikliği veriyi sessizce yerdi.
 */
async function preservedFields(
  absPath: string,
  next: EntryFrontmatter,
): Promise<Record<string, unknown>> {
  let data: Record<string, unknown>
  try {
    data = parseDocument(await fs.readFile(absPath, 'utf8')).data
  } catch {
    return {}
  }
  const keep: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(data)) {
    if (!(KEY_ORDER as string[]).includes(key)) keep[key] = value
  }
  const unknown = (list: readonly string[], value: unknown): value is string =>
    typeof value === 'string' && !list.includes(value)
  if (unknown(ENTRY_TYPES, data.type) && next.type === 'note') keep.type = data.type
  if (unknown(STATUSES, data.status) && next.status === undefined) keep.status = data.status
  if (
    unknown(SEVERITIES, data.severity) &&
    (next.severity === undefined || next.severity === 'medium')
  ) {
    keep.severity = data.severity
  }
  return keep
}

/**
 * Kaydı yazar. Var olan bir kaydı güncellerken `targetPath` olarak kaydın
 * KENDİ dosyası verilmeli: yol id'den yeniden türetilirse elle oluşturulmuş ya
 * da taşınmış bir dosyanın yanına ikinci bir kopya açılır ve güncellemeler
 * eskisinin gölgesinde kaybolur.
 */
export async function writeEntry(
  vaultRoot: string,
  frontmatter: EntryFrontmatter,
  body: string,
  targetPath?: string,
): Promise<string> {
  // Okuma yolu katı şemaya uymayan kaydı göstermez; geçersiz bir alanı (ör.
  // `status_since: 2w`) yazmak kaydı görünmez yapardı. Yazmadan önce reddet.
  const validation = validateFrontmatter(frontmatter)
  if (!validation.ok) throw new Error(`Geçersiz kayıt: ${validation.errors.join(', ')}`)
  const absPath = targetPath ?? path.join(vaultRoot, entryRelativePath(frontmatter.id))
  const extra = targetPath ? await preservedFields(absPath, frontmatter) : {}
  await writeFileAtomic(absPath, serializeDocument(frontmatter, body, extra))
  return absPath
}

/**
 * Boşta bir kimlik bulur. `makeEntryId` dakika hassasiyetinde çalışıyor: aynı
 * dakikada aynı başlıkla iki kayıt (geriye dönük aktarımda gerçekten oluyor)
 * aynı dosyaya düşer ve ikincisi birincisini SESSİZCE ezerdi.
 */
async function freeEntryId(vaultRoot: string, base: string): Promise<string> {
  for (let index = 0; index < 50; index += 1) {
    const candidate = index === 0 ? base : `${base}-${index + 1}`
    try {
      await fs.access(path.join(vaultRoot, entryRelativePath(candidate)))
    } catch {
      return candidate
    }
  }
  return `${base}-${Date.now()}`
}

export async function createEntry(
  vaultRoot: string,
  draft: EntryDraft,
  sourceId = 'vault',
): Promise<Entry> {
  // Yalnız CLI/MCP kullanan biri masaüstünü hiç açmayabilir; ajan rehberi
  // (CLAUDE.md/AGENTS.md) ve taxonomy.yaml ilk yazımda yine de yerinde olsun.
  await ensureVault(vaultRoot)
  const occurred = draft.occurred_at ? new Date(draft.occurred_at) : new Date()
  const now = localIso()
  const frontmatter: EntryFrontmatter = {
    // Başlık da sır taşıyabilir (`TOKEN=… npx wrangler deploy` gibi bir deploy
    // komutu başlık olur) ve id/dosya adına da oradan geçer — önce maskele.
    // Takımda yazar adı id'ye girer: iki kişi çevrimdışıyken aynı dakikada aynı
    // başlıkla kayıt açarsa `freeEntryId` bunu göremez (öbürünün dosyası henüz
    // gelmedi) ve eşitlemede iki farklı içerik aynı yola düşerdi.
    id: await freeEntryId(
      vaultRoot,
      makeEntryId(occurred, [draft.author, redact(draft.title).text].filter(Boolean).join(' ')),
    ),
    title: redact(draft.title).text,
    type: draft.type,
    severity: draft.severity,
    status: draft.status,
    occurred_at: draft.occurred_at ?? localIso(occurred),
    created_at: now,
    updated_at: now,
    author: draft.author,
    project: draft.project,
    area: draft.area,
    tags: draft.tags,
    refs: draft.refs,
  }
  const absPath = await writeEntry(vaultRoot, frontmatter, draft.body)
  return toEntry(frontmatter, draft.body, absPath, { sourceId, readOnly: false })
}

export async function deleteEntryFile(absPath: string): Promise<void> {
  await fs.rm(absPath, { force: true })
}

const VAULT_GUIDE = `# devlog vault

Bu klasör bir **seyir defteri**dir: ürün geliştirirken oluşan olaylar, kararlar,
incident'lar, güvenlik bulguları ve fikirler tarihleriyle burada tutulur.
Masaüstü uygulaması ve AI ajanı aynı dosyaları okur/yazar.

## Dosya düzeni

    entries/YYYY/MM/YYYY-MM-DD-HHmm-<slug>.md

Dosya adının gövdesi kaydın **değişmez \`id\`**'sidir ve frontmatter'daki \`id\`
ile birebir aynıdır. Bir kaydı yeniden adlandırma — yeni kayıt aç.

## Frontmatter kontratı

\`\`\`yaml
---
id: 2026-07-30-1432-api-gateway-ratelimit-deploy
title: api-gateway rateLimit prod'a deploy edildi
type: incident          # incident|security|devlog|update|idea|decision|deploy|meeting|note
severity: high          # critical|high|medium|low|info — incident/security icin ZORUNLU
status: monitoring      # open|in-progress|blocked|verified|monitoring|fixed|done|wontfix
occurred_at: 2026-07-30T14:32:00+03:00   # OLAYIN zamani (kaydin degil)
created_at:  2026-07-30T17:05:11+03:00
updated_at:  2026-07-30T17:27:02+03:00
project: myapp
area: api
tags: [api-gateway, auth, rate-limit]
refs:
  commits: [3f2c9e1a]
  files:   [services/api-gateway/src/index.ts]
  links:   ["[[login-rate-limit-bypass]]"]
---
\`\`\`

Zorunlu alanlar: \`id\`, \`title\`, \`type\`, \`occurred_at\`, \`created_at\`.
İzin verilen değerler \`taxonomy.yaml\` içinde açıklanmıştır.

## Takip katmanı (\`tracking/\`)

Kayıt bir OLAYI anlatır (geçmiş zaman). Takip dosyası o konunun BUGÜNKÜ hâlini
tutar (şimdiki zaman):

    tracking/<kaydin-id-si>.md

\`\`\`yaml
---
tracks: login-rate-limit-bypass
source: claude-memory:-Users-alice-...-myapp
status: open
severity: critical
next_action: login endpoint'ine IP basina rate limit ekle
next_review: 2026-09-01
status_since: 2026-08-19T14:12:00+03:00
updated_at: 2026-08-19T14:12:00+03:00
by: user
---
Serbest not (istege bagli).
\`\`\`

Bu katmanın tek varlık sebebi şu: takip edilen konuların çoğu **salt-okunur
aynalarda** (Claude memory) yaşıyor ve o dosyalara yazılmaz. Takip dosyası
kaynağı hiç ellemeden durumu vault'a taşır; okuma sırasında kaydın üstüne biner.
Yazılabilir kayıtlarda durum kaydın kendi frontmatter'ında tutulur — onlar için
takip dosyası açılmaz.

Geçmiş tutulmaz: vault bir git deposu, "ne zaman değişti" sorusunun cevabı
\`git log tracking/\`'dedir.

## Kurallar

1. **\`occurred_at\` olayın zamanıdır**, kaydı yazdığın an değil. Geçmişe dönük bir
   olay kaydediyorsan bu alanı olayın gerçek zamanına ayarla.
2. Gövdede \`[[baska-kaydin-id-si]]\` ile bağlantı kur. Backlink'ler otomatik çıkar.
3. Bir kaydı güncellerken \`updated_at\`'ı tazele, \`created_at\`'a dokunma.
4. **Sır yazma.** Token, anahtar, \`.env\` içeriği, imzalı URL buraya girmez.
5. Uygulamaya bağlı salt-okunur aynalara (ör. Claude memory) **yazma** — onlar
   başka bir aracın dosyaları.
6. **Takım vault'unda** (frontmatter'da \`author\` olan kayıtlar) yalnız kendi
   kayıtlarını düzenle. Başkasının kaydına ek yapmak istiyorsan kendi kaydını
   aç ve gövdede \`[[onun-id-si]]\` ile bağla — iki kişi asla aynı dosyaya
   yazmaz, eşitleme bu sayede hiç çakışmaz. Takım deposuna giden her şeyi ekip
   görür: güvenlik bulgusu, prod referansı, müşteri verisi buraya girmez.
`

/** Vault yoksa kurar; varsa eksik dosyaları tamamlar. Var olanı asla ezmez. */
export async function ensureVault(root: string): Promise<void> {
  await fs.mkdir(path.join(root, 'entries'), { recursive: true })
  // Takip dizini baştan var olmalı: dosya izleyici var olmayan bir yolu
  // güvenilir izleyemez ve ilk durum değişikliği UI'a yansımazdı.
  await fs.mkdir(path.join(root, 'tracking'), { recursive: true })
  const files: Array<[string, string]> = [
    ['CLAUDE.md', VAULT_GUIDE],
    ['AGENTS.md', VAULT_GUIDE],
    ['taxonomy.yaml', TAXONOMY_YAML],
    ['.gitignore', `${['.devlog/', '.DS_Store', '*.tmp-*', '.env*', '*.key', '*.pem'].join('\n')}\n`],
  ]
  for (const [name, contents] of files) {
    const target = path.join(root, name)
    try {
      await fs.access(target)
    } catch {
      await fs.writeFile(target, contents, 'utf8')
    }
  }
}
