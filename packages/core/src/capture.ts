import { ENTRY_TYPES, SEVERITIES, SEVERITY_REQUIRED_TYPES } from './types.js'
import type { EntryDraft, EntryType, Severity } from './types.js'

/**
 * Hızlı yakalama penceresinin satır-içi komut dili.
 *
 *   Prod'da api-gateway patladı /incident !critical @api #auth #worker
 *
 * `/tür` `!severity` `@alan` `#etiket` `+takım` — metnin herhangi bir yerinde olabilir,
 * ayıklanır ve geri kalan ilk satır başlık, kalanı gövde olur.
 *
 * Tasarım kararı: `/` ile başlayan bir token **tanınan bir tür değilse** metinde
 * bırakılır. Böylece `/Users/...` gibi yollar ya da normal eğik çizgi kullanımı
 * sessizce yutulmaz.
 */

const TYPE_ALIASES: Record<string, EntryType> = {
  inc: 'incident',
  olay: 'incident',
  sec: 'security',
  guvenlik: 'security',
  dev: 'devlog',
  gunluk: 'devlog',
  log: 'devlog',
  upd: 'update',
  guncelleme: 'update',
  fikir: 'idea',
  karar: 'decision',
  dep: 'deploy',
  ship: 'deploy',
  cikis: 'deploy',
  git: 'commit',
  commit: 'commit',
  mtg: 'meeting',
  meet: 'meeting',
  toplanti: 'meeting',
  not: 'note',
  note: 'note',
}

const SEVERITY_ALIASES: Record<string, Severity> = {
  kritik: 'critical',
  crit: 'critical',
  yuksek: 'high',
  orta: 'medium',
  med: 'medium',
  dusuk: 'low',
  bilgi: 'info',
}

const TYPE_SET = new Set<string>(ENTRY_TYPES)
const SEVERITY_SET = new Set<string>(SEVERITIES)

function normalizeToken(token: string): string {
  return token
    .toLowerCase()
    .replace(/ı/g, 'i')
    .replace(/ş/g, 's')
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c')
}

export function resolveType(token: string): EntryType | undefined {
  const key = normalizeToken(token)
  if (TYPE_SET.has(key)) return key as EntryType
  return TYPE_ALIASES[key]
}

export function resolveSeverity(token: string): Severity | undefined {
  const key = normalizeToken(token)
  if (SEVERITY_SET.has(key)) return key as Severity
  return SEVERITY_ALIASES[key]
}

export interface CaptureParse {
  title: string
  body: string
  type: EntryType
  severity?: Severity
  area?: string
  tags: string[]
  /** `+takım` — kayıt o takımın ortak feed'ine gider. */
  team?: string
  /** Kullanıcı türü açıkça yazdı mı — UI çipini vurgulamak için. */
  explicitType: boolean
}

/** `#` hemen ardından boşluksuz kelime gelirse etikettir; `# Başlık` markdown'dır. */
const TAG_RE = /(^|\s)#([\p{L}\p{N}][\p{L}\p{N}_-]*)/gu
// Komut token'ı boşlukla ya da metin sonuyla bitmeli: yoksa `/dev/shm` içindeki
// `/dev`, `/log/app.log` içindeki `/log` tür sanılıp yoldan kesilirdi.
const TYPE_RE = /(^|\s)\/([\p{L}\p{N}_-]+)(?=\s|$)/gu
const SEVERITY_RE = /(^|\s)!([\p{L}\p{N}_-]+)(?=\s|$)/gu
const AREA_RE = /(^|\s)@([\p{L}\p{N}_-]+)(?=\s|$)/gu
const TEAM_RE = /(^|\s)\+([\p{L}\p{N}_-]+)(?=\s|$)/gu

export interface CaptureOptions {
  /**
   * Tanımlı takım id'leri. `+token` YALNIZ bunlardan biriyse yutulur: `+1`,
   * `+ekstra` gibi düz metin takım sanılıp kayıt yanlış yere (ya da hataya)
   * gitmesin. Takıma yazmak açık bir karar olmalı.
   */
  teams?: readonly string[]
}

export function parseCapture(input: string, options: CaptureOptions = {}): CaptureParse {
  let text = input
  let team: string | undefined
  const knownTeams = new Set((options.teams ?? []).map((id) => id.toLowerCase()))
  const tags: string[] = []
  let type: EntryType | undefined
  let severity: Severity | undefined
  let area: string | undefined

  text = text.replace(TYPE_RE, (match, lead: string, token: string) => {
    const resolved = resolveType(token)
    if (!resolved || type) return match
    type = resolved
    return lead
  })

  text = text.replace(SEVERITY_RE, (match, lead: string, token: string) => {
    const resolved = resolveSeverity(token)
    if (!resolved || severity) return match
    severity = resolved
    return lead
  })

  text = text.replace(AREA_RE, (match, lead: string, token: string) => {
    if (area) return match
    area = token.toLowerCase()
    return lead
  })

  text = text.replace(TEAM_RE, (match, lead: string, token: string) => {
    const id = token.toLowerCase()
    if (team || !knownTeams.has(id)) return match
    team = id
    return lead
  })

  text = text.replace(TAG_RE, (_match, lead: string, token: string) => {
    const tag = token.toLowerCase()
    if (!tags.includes(tag)) tags.push(tag)
    return lead
  })

  const lines = text.split(/\r?\n/)
  const titleIndex = lines.findIndex((line) => line.trim().length > 0)
  const title = titleIndex === -1 ? '' : (lines[titleIndex] as string).trim().replace(/\s{2,}/g, ' ')
  const body = titleIndex === -1 ? '' : lines.slice(titleIndex + 1).join('\n').trim()

  const resolvedType = type ?? 'devlog'
  return {
    title,
    body,
    type: resolvedType,
    // Şema incident/security için severity zorunlu tutuyor; kullanıcı yazmadıysa
    // yakalamayı reddetmek yerine en muhafazakâr değere düşüyoruz.
    severity:
      severity ?? (SEVERITY_REQUIRED_TYPES.includes(resolvedType) ? 'medium' : undefined),
    area,
    tags,
    team,
    explicitType: type !== undefined,
  }
}

export function captureToDraft(parsed: CaptureParse): EntryDraft {
  return {
    title: parsed.title,
    type: parsed.type,
    body: parsed.body,
    severity: parsed.severity,
    area: parsed.area,
    tags: parsed.tags.length ? parsed.tags : undefined,
    team: parsed.team,
  }
}
