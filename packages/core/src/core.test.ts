import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { parseCapture } from './capture.js'
import { entryRelativePath, makeEntryId, toEntry } from './entry.js'
import { fold, slugify } from './fold.js'
import { extractWikilinks, mapOutsideCode, parseDocument, serializeDocument } from './frontmatter.js'
import { validateFrontmatter } from './schema.js'
import { MiniSearchIndex } from './search.js'
import { createEntry, readEntryFile, writeEntry } from './vault.js'
import { redact } from './redact.js'
import { expandHome } from './config.js'
import { readClaudeMemoryFile } from './sources/claude-memory.js'
import {
  applyTracking,
  loadTracking,
  matchTracking,
  parseTracking,
  trackEntry,
  trackingFileName,
  writeTracking,
} from './tracking-store.js'
import { trackingState } from './tracking.js'
import type { Entry, EntryFrontmatter, SourceInfo } from './types.js'

const tmpRoots: string[] = []

async function makeTmpDir(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix))
  tmpRoots.push(dir)
  return dir
}

afterAll(async () => {
  await Promise.all(tmpRoots.map((dir) => fs.rm(dir, { recursive: true, force: true })))
})

describe('fold — Türkçe diakritik katlama', () => {
  it('I / İ / ı / i dördünü de aynı token\'a düşürür', () => {
    expect(fold('I')).toBe('i')
    expect(fold('İ')).toBe('i')
    expect(fold('ı')).toBe('i')
    expect(fold('i')).toBe('i')
  })

  it('diakritikli ve ASCII-katlanmış yazımlar eşleşir', () => {
    expect(fold('söküm')).toBe(fold('sokum'))
    expect(fold('çıkarıldı')).toBe(fold('cikarildi'))
    expect(fold('GÜVENLİK')).toBe(fold('guvenlik'))
  })

  it('slugify dosya adına uygun çıktı üretir', () => {
    expect(slugify("api-gateway rateLimit prod'a deploy edildi")).toBe(
      'api-gateway-ratelimit-prod-a-deploy-edildi',
    )
    expect(slugify('Şifre sıfırlama açığı')).toBe('sifre-sifirlama-acigi')
    expect(slugify('   ')).toBe('kayit')
  })
})

describe('frontmatter', () => {
  const frontmatter: EntryFrontmatter = {
    id: '2026-07-30-1432-api-gateway-deploy',
    title: "api-gateway rateLimit prod'a deploy edildi",
    type: 'incident',
    severity: 'high',
    status: 'monitoring',
    occurred_at: '2026-07-30T14:32:00+03:00',
    created_at: '2026-07-30T17:05:11+03:00',
    updated_at: '2026-07-30T17:27:02+03:00',
    area: 'api',
    tags: ['api-gateway', 'auth', 'rate-limit'],
    refs: { commits: ['3f2c9e1a'], files: ['services/api-gateway/src/index.ts'] },
  }

  it('yaz → oku turunda alanları korur', () => {
    const body = 'Gövde metni.\n\n[[login-rate-limit-bypass]] ile ilgili.'
    const serialized = serializeDocument(frontmatter, body)
    const parsed = parseDocument(serialized)
    const result = validateFrontmatter(parsed.data)
    expect(result.ok).toBe(true)
    expect(result.value).toEqual(frontmatter)
    expect(parsed.body.trim()).toBe(body.trim())
  })

  it('boş alanları YAML\'a yazmaz', () => {
    const serialized = serializeDocument({ ...frontmatter, tags: [], refs: {} }, 'x')
    expect(serialized).not.toContain('tags:')
    expect(serialized).not.toContain('refs:')
  })

  it('incident/security için severity zorunlu', () => {
    const { severity, ...withoutSeverity } = frontmatter
    void severity
    expect(validateFrontmatter(withoutSeverity).ok).toBe(false)
    expect(validateFrontmatter({ ...withoutSeverity, type: 'devlog' }).ok).toBe(true)
  })

  it('tanınmayan türü düşürmez, note\'a çeker (ileri uyumluluk)', async () => {
    // Canlı yaşandı: taksonomiye `commit` eklenince, henüz yeniden derlenmemiş
    // MCP sunucusu o kayıtları TAMAMEN düşürdü — sessizce. Vault araçlardan
    // uzun yaşıyor; okuma yolu hoşgörülü olmak zorunda.
    const dir = await makeTmpDir('devlog-fwd-')
    const file = path.join(dir, 'x.md')
    await fs.writeFile(
      file,
      `---\nid: 2027-01-01-1200-gelecek\ntitle: gelecekten kayıt\ntype: hologram\nstatus: uydurma\noccurred_at: 2027-01-01T12:00:00+03:00\ncreated_at: 2027-01-01T12:00:00+03:00\n---\n\ngövde\n`,
      'utf8',
    )
    const outcome = await readEntryFile(file, { sourceId: 'vault', readOnly: false })
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.entry.type).toBe('note')
    expect(outcome.entry.status).toBeUndefined()
    // Şema kurtarması `coerced`'a düşer, `derived`'a değil: "dosyada yazıyordu
    // ama anlamadık" ile "dosyada hiç yoktu, metinden çıkardık" ayrı şeyler.
    expect(outcome.entry.coerced).toEqual(expect.arrayContaining(['type', 'status']))
    expect(outcome.entry.derived).toBeUndefined()
  })

  it('zorunlu alan eksikse yine reddeder', async () => {
    const dir = await makeTmpDir('devlog-bad-')
    const file = path.join(dir, 'y.md')
    await fs.writeFile(file, `---\ntitle: id yok\ntype: hologram\n---\n\ngövde\n`, 'utf8')
    const outcome = await readEntryFile(file, { sourceId: 'vault', readOnly: false })
    expect(outcome.ok).toBe(false)
  })

  it('wikilink hedeflerini çıkarır', () => {
    expect(extractWikilinks('bkz [[a-b-c]] ve [[d-e|etiket]] ve tekrar [[a-b-c]]')).toEqual([
      'a-b-c',
      'd-e',
    ])
  })

  it('kod içindeki wikilinkleri bağlantı saymaz', () => {
    // Kod verbatim: hem işleme hem çıkarım aynı kuralı uygular, yoksa
    // "Buraya bağlananlar"da görünüp gövdede tıklanamayan hayalet bağlantı olur.
    expect(extractWikilinks('satır içi `[[kod-icinde]]` ve gerçek [[hedef]]')).toEqual(['hedef'])
    expect(extractWikilinks('```\n[[blok-icinde]]\n```\n[[disarida]]')).toEqual(['disarida'])
  })

  it('mapOutsideCode kod bölgelerini değiştirmez', () => {
    const input = 'a [[x]] `b [[y]] c` d ```\n[[z]]\n``` e [[w]]'
    const output = mapOutsideCode(input, (chunk) => chunk.replaceAll('[[', '<<').replaceAll(']]', '>>'))
    expect(output).toBe('a <<x>> `b [[y]] c` d ```\n[[z]]\n``` e <<w>>')
  })
})

describe('id ve yol üretimi', () => {
  it('tarih damgalı id üretir', () => {
    expect(makeEntryId(new Date(2026, 6, 30, 14, 32), 'api-gateway deploy')).toBe(
      '2026-07-30-1432-api-gateway-deploy',
    )
  })

  it('id\'den tarih bölmeli yol türetir', () => {
    expect(entryRelativePath('2026-07-30-1432-x')).toBe('entries/2026/07/2026-07-30-1432-x.md')
    expect(entryRelativePath('bozuk-id')).toBe('entries/diger/bozuk-id.md')
  })
})

describe('parseCapture — satır içi komutlar', () => {
  it('tür, severity, alan ve etiketleri ayıklar', () => {
    const parsed = parseCapture("Prod'da api-gateway patladı /incident !critical @api #auth #worker\nDetay satırı")
    expect(parsed.title).toBe("Prod'da api-gateway patladı")
    expect(parsed.body).toBe('Detay satırı')
    expect(parsed.type).toBe('incident')
    expect(parsed.severity).toBe('critical')
    expect(parsed.area).toBe('api')
    expect(parsed.tags).toEqual(['auth', 'worker'])
  })

  it('Türkçe takma adları çözer', () => {
    expect(parseCapture('x /guvenlik').type).toBe('security')
    expect(parseCapture('x /fikir').type).toBe('idea')
    expect(parseCapture('x /incident !kritik').severity).toBe('critical')
  })

  it('tanınmayan eğik çizgi token\'ını metinde bırakır', () => {
    const parsed = parseCapture('dosya /Users/alice/notes.md içinde')
    expect(parsed.title).toBe('dosya /Users/alice/notes.md içinde')
    expect(parsed.type).toBe('devlog')
    expect(parsed.explicitType).toBe(false)
  })

  it('markdown başlığını etiket sanmaz', () => {
    expect(parseCapture('Başlık\n# Alt başlık').tags).toEqual([])
  })

  it('incident için severity yoksa medium\'a düşer', () => {
    expect(parseCapture('x /incident').severity).toBe('medium')
    expect(parseCapture('x /devlog').severity).toBeUndefined()
  })
})

describe('claude-memory adaptörü — durum çıkarımı', () => {
  const source: SourceInfo = {
    id: 'claude-memory:test',
    label: 'test',
    root: '/tmp/-Users-x-myapp/memory',
    readOnly: true,
    dialect: 'claude-memory',
  }

  async function writeMemory(dir: string, name: string, body: string): Promise<string> {
    const file = path.join(dir, `${name}.md`)
    await fs.writeFile(
      file,
      `---\nname: ${name}\ndescription: "test kaydı"\nmetadata:\n  node_type: memory\n  type: project\n  modified: 2026-07-30T14:27:02.525Z\n---\n\n${body}\n`,
      'utf8',
    )
    return file
  }

  it('"CANLI DOĞRULANDI + fix uygulanmadı" gövdesini open sayar', async () => {
    const dir = await makeTmpDir('devlog-mem-')
    const file = await writeMemory(
      dir,
      'vuln-ornek',
      '2026-06-25, CANLI DOĞRULANDI prod\'da. 🔴 KRİTİK. fix uygulanmadı.',
    )
    const entry = await readClaudeMemoryFile(file, source)
    expect(entry).not.toBeNull()
    expect(entry?.type).toBe('security')
    expect(entry?.severity).toBe('critical')
    // Açık bulgunun canlı doğrulanmış olması onu düzeltilmiş yapmaz.
    expect(entry?.status).toBe('open')
    expect(entry?.occurred_at.startsWith('2026-06-25')).toBe(true)
    expect(entry?.readOnly).toBe(true)
    expect(entry?.derived).toContain('status')
  })

  it('📌 İZLEMEDE gövdesini monitoring sayar', async () => {
    const dir = await makeTmpDir('devlog-mem-')
    const file = await writeMemory(dir, 'vuln-izlemede', '📌 2026-07-30 DEPLOY — İZLEMEDE: ✅ FIX')
    const entry = await readClaudeMemoryFile(file, source)
    expect(entry?.status).toBe('monitoring')
  })

  it('✅ FIXLENDİ gövdesini fixed sayar', async () => {
    const dir = await makeTmpDir('devlog-mem-')
    const file = await writeMemory(dir, 'vuln-fix', '2026-06-25 ✅ FIXLENDİ ve prod\'da doğrulandı')
    const entry = await readClaudeMemoryFile(file, source)
    expect(entry?.status).toBe('fixed')
  })

  it('kaynak dosyaya yazmaz', async () => {
    const dir = await makeTmpDir('devlog-mem-')
    const file = await writeMemory(dir, 'vuln-dokunma', 'içerik')
    const before = await fs.readFile(file, 'utf8')
    await readClaudeMemoryFile(file, source)
    expect(await fs.readFile(file, 'utf8')).toBe(before)
  })
})

describe('MiniSearchIndex', () => {
  const base = {
    type: 'devlog' as const,
    created_at: '2026-07-01T10:00:00+03:00',
    body: '',
    path: '/x',
    sourceId: 'vault',
    readOnly: false,
  }

  function entry(id: string, title: string, occurred: string, body = '') {
    return toEntry(
      { id, title, type: base.type, occurred_at: occurred, created_at: base.created_at },
      body,
      `/vault/${id}.md`,
      { sourceId: 'vault', readOnly: false },
    )
  }

  it('diakritikten bağımsız arar', () => {
    const index = new MiniSearchIndex()
    index.replaceAll([entry('a', 'Görev söküm planı', '2026-07-01T10:00:00+03:00')])
    expect(index.query({ text: 'sokum' }).total).toBe(1)
    expect(index.query({ text: 'söküm' }).total).toBe(1)
    expect(index.query({ text: 'gorev' }).total).toBe(1)
  })

  it('tarih aralığını gün anahtarıyla filtreler', () => {
    const index = new MiniSearchIndex()
    index.replaceAll([
      entry('a', 'eski', '2026-07-01T10:00:00+03:00'),
      entry('b', 'yeni', '2026-07-20T10:00:00+03:00'),
    ])
    expect(index.query({ from: '2026-07-10' }).total).toBe(1)
    expect(index.query({ to: '2026-07-10' }).total).toBe(1)
  })

  it('karışık saat-dilimi biçimlerini doğru sıralar (regresyon)', () => {
    // Vault `+03:00` yazar, Claude memory'nin metadata.modified'ı UTC `Z`.
    // Dizge karşılaştırmasında "20:36Z" < "23:25+03:00" çıkıyordu; oysa
    // 20:36Z = yerel 23:36, yani DAHA YENİ. Bu satır o hatayı kilitler.
    const index = new MiniSearchIndex()
    index.replaceAll([
      entry('vault', 'vault kaydı', '2026-07-30T23:25:22+03:00'),
      entry('mirror', 'ayna kaydı', '2026-07-30T20:36:28.272Z'),
    ])
    expect(index.query({ sort: 'newest' }).items.map((e) => e.id)).toEqual(['mirror', 'vault'])
    expect(index.query({ sort: 'oldest' }).items.map((e) => e.id)).toEqual(['vault', 'mirror'])
  })

  it('çok kelimeli sorguda AND boşsa OR\'a düşer', () => {
    // Ajan tarafı için kritik: 3 kelimelik sorguda tek kelime tutmazsa boş
    // küme dönüyordu ve çağıran "kayıt yok" sonucuna varıyordu.
    const index = new MiniSearchIndex()
    index.replaceAll([entry('a', 'hook komut eşleşmesi çapalandı', '2026-07-01T10:00:00+03:00')])
    expect(index.query({ text: 'hook komut' }).total).toBe(1)
    expect(index.query({ text: 'hook komut bulunmayankelime' }).total).toBe(1)
  })

  it('backlink grafiğini kurar', () => {
    const index = new MiniSearchIndex()
    index.replaceAll([
      entry('hedef', 'hedef kayıt', '2026-07-01T10:00:00+03:00'),
      entry('kaynak', 'kaynak kayıt', '2026-07-02T10:00:00+03:00', 'bkz [[hedef]]'),
    ])
    expect(index.backlinks('hedef').map((e) => e.id)).toEqual(['kaynak'])
    index.remove('kaynak')
    expect(index.backlinks('hedef')).toEqual([])
  })

  it('gün bazlı facet üretir (takvim ısı görünümü için)', () => {
    const index = new MiniSearchIndex()
    index.replaceAll([
      entry('a', 'x', '2026-07-01T10:00:00+03:00'),
      entry('b', 'y', '2026-07-01T18:00:00+03:00'),
      entry('c', 'z', '2026-07-02T09:00:00+03:00'),
    ])
    expect(index.facets().days['2026-07-01']).toBe(2)
    expect(index.facets().days['2026-07-02']).toBe(1)
  })
})

describe('takip katmanı', () => {
  const source: SourceInfo = {
    id: 'claude-memory:test',
    label: 'test',
    root: '/tmp/-Users-x-myapp/memory',
    readOnly: true,
    dialect: 'claude-memory',
  }

  function mirrorEntry(overrides: Partial<Entry> = {}): Entry {
    return {
      id: 'vuln-ornek',
      title: 'Örnek bulgu',
      type: 'security',
      severity: 'medium',
      status: 'open',
      occurred_at: '2026-06-01T12:00:00+03:00',
      created_at: '2026-06-01T12:00:00+03:00',
      updated_at: '2026-08-18T12:00:00+03:00',
      body: 'gövde',
      path: '/tmp/-Users-x-myapp/memory/vuln-ornek.md',
      sourceId: source.id,
      readOnly: true,
      derived: ['type', 'status', 'occurred_at'],
      ...overrides,
    }
  }

  it('takip kaydı çıkarımı ezer ve "tahmin" işaretini kaldırır', () => {
    const merged = applyTracking(mirrorEntry(), {
      tracks: 'vuln-ornek',
      status: 'fixed',
      updated_at: '2026-08-19T10:00:00+03:00',
      status_since: '2026-08-19T10:00:00+03:00',
    })
    expect(merged.status).toBe('fixed')
    expect(merged.overridden).toContain('status')
    expect(merged.derived).not.toContain('status')
    // Kaynağın kendi zamanı korunur; takip dosyasının tazeliği ayrı ölçülür.
    expect(merged.updated_at).toBe('2026-08-18T12:00:00+03:00')
  })

  it('yazılabilir kayıtta takip dosyası YOK SAYILIR', () => {
    const writable = mirrorEntry({ readOnly: false, sourceId: 'vault', status: 'open' })
    const merged = applyTracking(writable, {
      tracks: 'vuln-ornek',
      status: 'fixed',
      updated_at: '2026-08-19T10:00:00+03:00',
    })
    // Tek gerçek kaydın kendi frontmatter'ıdır — yoksa "düzenledim ama
    // ekranda değişmedi" sınıfı bir hayalet doğar.
    expect(merged.status).toBe('open')
    expect(merged.overridden).toBeUndefined()
  })

  it('dosya adı yol kaçışı içermez ve büyük/küçük harfte çakışmaz', () => {
    expect(trackingFileName('../../../.claude/settings')).not.toContain('..')
    expect(trackingFileName('../../../.claude/settings')).not.toContain('/')
    expect(trackingFileName('Vuln-A')).not.toBe(trackingFileName('vuln-a'))
  })

  it('durum değişikliğini yazarken kaynak dosyaya tek bayt yazmaz', async () => {
    const memDir = await makeTmpDir('devlog-mem-')
    const vaultRoot = await makeTmpDir('devlog-vault-')
    const file = path.join(memDir, 'vuln-ornek.md')
    await fs.writeFile(
      file,
      '---\nname: vuln-ornek\ndescription: "örnek"\n---\n\n2026-06-01 fix uygulanmadı\n',
      'utf8',
    )
    const before = await fs.readFile(file, 'utf8')
    const entry = await readClaudeMemoryFile(file, source)
    expect(entry?.status).toBe('open')

    const outcome = await trackEntry(vaultRoot, entry!, { status: 'fixed' }, 'user')
    expect(outcome.target).toBe('tracking')
    expect(await fs.readFile(file, 'utf8')).toBe(before)

    const stored = await loadTracking(vaultRoot)
    expect(stored.get('vuln-ornek')?.status).toBe('fixed')
    expect(stored.get('vuln-ornek')?.source_file).toBe('vuln-ornek.md')
  })

  it('tanımadığı frontmatter anahtarlarını koruyarak geri yazar', async () => {
    const vaultRoot = await makeTmpDir('devlog-vault-')
    await writeTracking(vaultRoot, {
      tracks: 'gelecek-alan',
      status: 'open',
      updated_at: '2026-08-19T10:00:00+03:00',
      extra: { gelecek_alan: 'korunmalı' },
    })
    const reloaded = (await loadTracking(vaultRoot)).get('gelecek-alan')
    expect(reloaded?.extra?.gelecek_alan).toBe('korunmalı')
  })

  it('kaynak yeniden adlandırılsa bile dosya adından kurtarır, öksüzü silmez', () => {
    const renamed = mirrorEntry({ id: 'vuln-ornek-yeni-ad' })
    const tracking = new Map([
      [
        'vuln-ornek',
        {
          tracks: 'vuln-ornek',
          source_file: 'vuln-ornek.md',
          status: 'fixed' as const,
          updated_at: '2026-08-19T10:00:00+03:00',
        },
      ],
    ])
    const { byEntry, orphans } = matchTracking([renamed], tracking)
    expect(byEntry.get('vuln-ornek-yeni-ad')?.status).toBe('fixed')
    expect(orphans).toHaveLength(0)

    const gone = matchTracking([], tracking)
    expect(gone.orphans.map((r) => r.tracks)).toEqual(['vuln-ornek'])
  })

  it('bayatlık kaynağın değişim zamanından DEĞİL, durumun değiştiği andan sayılır', () => {
    const now = new Date('2026-08-19T12:00:00+03:00')
    // Ajan dün dosyaya bir satır ekledi (updated_at taze) ama durum 60 gündür aynı.
    const entry = mirrorEntry({
      status: 'open',
      occurred_at: '2026-06-10T12:00:00+03:00',
      updated_at: '2026-08-18T12:00:00+03:00',
    })
    expect(trackingState(entry, now).ageDays).toBe(70)
    expect(trackingState(entry, now).stale).toBe(true)

    const touched = { ...entry, status_since: '2026-08-18T12:00:00+03:00' }
    expect(trackingState(touched, now).ageDays).toBe(1)
    expect(trackingState(touched, now).stale).toBe(false)
  })

  it('takip dosyasının kimliği dosya adı değil `tracks` alanıdır', () => {
    const record = parseTracking('---\ntracks: gercek-id\nstatus: open\n---\n', 'baska-ad')
    expect(record?.tracks).toBe('gercek-id')
  })
})

describe('durum çıkarımı — kısmi ilerleme ve wontfix', () => {
  const source: SourceInfo = {
    id: 'claude-memory:test',
    label: 'test',
    root: '/tmp/-Users-x-myapp/memory',
    readOnly: true,
    dialect: 'claude-memory',
  }

  async function memory(body: string, description = 'test kaydı'): Promise<Entry | null> {
    const dir = await makeTmpDir('devlog-mem-')
    const file = path.join(dir, 'vuln-ornek.md')
    await fs.writeFile(file, `---\nname: vuln-ornek\ndescription: "${description}"\n---\n\n${body}\n`, 'utf8')
    return readClaudeMemoryFile(file, source)
  }

  it('"test\'te doğrulandı, PROD deploy bekliyor" gövdesini in-progress sayar', async () => {
    const entry = await memory("2026-07-14 TEST'te uygulandı; PROD deploy bekliyor (0 satır)")
    expect(entry?.status).toBe('in-progress')
  })

  it('yalnız "fix uygulanmadı" varsa open kalır', async () => {
    const entry = await memory('2026-07-07 statik-doğrulandı, fix uygulanmadı')
    expect(entry?.status).toBe('open')
  })

  it('wontfix ASLA çıkarılmaz — o bir karardır', async () => {
    const entry = await memory('Bulgu 3: profil sayfası XSS = SÖMÜRÜLEMEZ, kapsam dışı')
    expect(entry?.status).not.toBe('wontfix')
  })

  it('gövde sessizse durumu başlıktan çıkarır', async () => {
    const entry = await memory('teknik ayrıntı', '✅ FIXLENDİ + prod doğrulandı')
    expect(entry?.status).toBe('fixed')
  })

  it('durum çıkarılamadıysa `derived` içinde status YAZMAZ', async () => {
    const entry = await memory('nötr bir not')
    expect(entry?.status).toBeUndefined()
    expect(entry?.derived).not.toContain('status')
  })
})

describe('yazma yolu — veri kaybı ve görünmez kayıt korumaları', () => {
  async function vaultWith(file: string, contents: string): Promise<{ root: string; abs: string }> {
    const root = await makeTmpDir('devlog-write-')
    const abs = path.join(root, 'entries', file)
    await fs.mkdir(path.dirname(abs), { recursive: true })
    await fs.writeFile(abs, contents, 'utf8')
    return { root, abs }
  }

  const handmade = [
    '---',
    'id: elle-yazilmis',
    'title: Elle yazılmış kayıt',
    'type: retro',
    'occurred_at: 2026-07-01T10:00:00+03:00',
    'created_at: 2026-07-01T10:00:00+03:00',
    'author: alice',
    '---',
    '',
    'ilk gövde',
    '',
  ].join('\n')

  it('güncelleme kaydın kendi dosyasına yazar, ikinci kopya açmaz', async () => {
    const { root, abs } = await vaultWith('elle.md', handmade)
    const outcome = await readEntryFile(abs, { sourceId: 'vault', readOnly: false })
    if (!outcome.ok) throw new Error('okunamadı')
    const written = await trackEntry(root, outcome.entry, { status: 'open' })
    expect(written.path).toBe(abs)
    const files = await fs.readdir(path.join(root, 'entries'), { recursive: true })
    expect(files.filter((f) => String(f).endsWith('.md'))).toEqual(['elle.md'])
  })

  it('tanınmayan alanları ve okurken çekilmiş enum değerini korur', async () => {
    const { root, abs } = await vaultWith('elle.md', handmade)
    const outcome = await readEntryFile(abs, { sourceId: 'vault', readOnly: false })
    if (!outcome.ok) throw new Error('okunamadı')
    expect(outcome.entry.type).toBe('note')
    await trackEntry(root, outcome.entry, { status: 'in-progress' })
    const raw = await fs.readFile(abs, 'utf8')
    expect(raw).toContain('author: alice')
    expect(raw).toContain('type: retro')
    expect(raw).toContain('status: in-progress')
  })

  it('geçersiz tarih yazılmadan reddedilir — kayıt görünmez olmaz', async () => {
    const { root, abs } = await vaultWith('elle.md', handmade)
    const outcome = await readEntryFile(abs, { sourceId: 'vault', readOnly: false })
    if (!outcome.ok) throw new Error('okunamadı')
    await expect(trackEntry(root, outcome.entry, { status_since: '2w' })).rejects.toThrow(/status_since/)
    await expect(trackEntry(root, outcome.entry, { next_review: 'gelecek hafta' })).rejects.toThrow(/next_review/)
    expect(await fs.readFile(abs, 'utf8')).toBe(handmade)
  })

  it('başlıktaki sır id\'ye ve dosya adına sızmaz', async () => {
    const root = await makeTmpDir('devlog-title-')
    const entry = await createEntry(root, {
      title: 'Deploy: CLOUDFLARE_API_TOKEN=abcd1234abcd1234abcd npx wrangler deploy',
      type: 'deploy',
      body: '',
    })
    expect(entry.title).not.toContain('abcd1234')
    expect(entry.id).not.toContain('abcd1234')
    expect(entry.path).not.toContain('abcd1234')
  })

  it('BOM ile kaydedilmiş dosyayı okur', async () => {
    const { abs } = await vaultWith('bom.md', `\uFEFF${handmade}`)
    const outcome = await readEntryFile(abs, { sourceId: 'vault', readOnly: false })
    expect(outcome.ok).toBe(true)
  })

  it('writeEntry katı şemaya uymayan frontmatter\'ı reddeder', async () => {
    const root = await makeTmpDir('devlog-invalid-')
    await expect(
      writeEntry(root, {
        id: 'x',
        title: 'x',
        type: 'security',
        occurred_at: 'dün',
        created_at: '2026-07-01T10:00:00+03:00',
      } as EntryFrontmatter, ''),
    ).rejects.toThrow(/Geçersiz kayıt/)
  })
})

describe('redact — ek desenler', () => {
  // Sahte sırlar parçalardan birleştirilir: kaynakta düz yazılırsa GitHub secret
  // scanning ve benzeri tarayıcılar onları gerçek anahtar sanıp alarm üretir.
  const fake = (...parts: string[]): string => parts.join('')
  it.each([
    ['sonu kesilmiş PEM', fake('-----BEGIN ', 'PRIVATE KEY-----\n', 'MIIEvQIBADANBgkqhkiG9w0BAQEFAASC')],
    ['yeni OpenAI anahtarı', fake('sk-', 'proj-', 'Ab_cd-EfGhIjKlMnOpQrStUvWxYz0123456789')],
    ['küçük harfli env', 'db_password=hunter2hunter2'],
    ['JSON alanı', '{"password": "hunter2hunter2"}'],
    ['Bearer', 'Authorization: Bearer abcdefghijklmnopqrstuvwxyz012345'],
    ['Google', fake('AI', 'za', 'SyA1234567890abcdefghijklmnopqrstuv')],
  ])('%s maskelenir', (_label, input) => {
    expect(redact(input).found.length).toBeGreaterThan(0)
  })

  it('düz yazıyı maskelemez', () => {
    expect(redact('password: değiştirilmeli, token süresi 15 dk').found).toEqual([])
  })
})

describe('capture — yol koruması', () => {
  it('tür takma adıyla başlayan yol parçasını yutmaz', () => {
    expect(parseCapture('Cleaned up /dev/shm leak').title).toBe('Cleaned up /dev/shm leak')
    expect(parseCapture('rotate /log/app.log /incident').type).toBe('incident')
    expect(parseCapture('rotate /log/app.log /incident').title).toBe('rotate /log/app.log')
  })
})

describe('config — yol açma', () => {
  it('~ ev dizinine açılır, göreli yol mutlak olur', () => {
    expect(expandHome('~/vault')).toBe(path.join(os.homedir(), 'vault'))
    expect(path.isAbsolute(expandHome('vault'))).toBe(true)
  })
})

describe('parseCapture — +takım', () => {
  it('yalnız tanımlı takımı yutar, düz metindeki +token\'a dokunmaz', () => {
    const parsed = parseCapture('Ödeme +ekip akışı +1 oldu', { teams: ['ekip'] })
    expect(parsed.team).toBe('ekip')
    expect(parsed.title).toBe('Ödeme akışı +1 oldu')
    expect(parseCapture('Ödeme +ekip').team).toBeUndefined()
  })
})
