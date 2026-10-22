import { createReadStream } from 'node:fs'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createInterface } from 'node:readline'
import { redact } from '@devlog/core'
import type { EntryDraft } from '@devlog/core'
import { marker, repoInfo, truncate } from './hooks/shared.js'

/**
 * Claude Code oturum transcript'lerini seyir defteri kaydına çeviren ortak yol.
 *
 * Hem `SessionEnd` hook'u (oturum biterken) hem `devlog backfill` (geriye dönük)
 * buradan geçer — yoksa "hook'un yazdığı kayıt" ile "elle aktarılan kayıt" iki
 * farklı biçimde olurdu ve defterde iki ayrı tür kayıt yaşardı.
 */

export interface TranscriptSummary {
  title: string | null
  prompts: string[]
  files: string[]
  commits: string[]
  firstTimestamp: string | null
  lastTimestamp: string | null
  cwd: string | null
  branch: string | null
  sessionId: string | null
  /** Kullanıcının yazdığı istek sayısı — oturumun "ağırlığı". */
  promptCount: number
  /**
   * Asistanın son metni. Yalnız KONUŞMA olan oturumlarda (dosya değişmemiş,
   * commit atılmamış) kayıt aksi hâlde "ne sorduğumdan" ibaret kalıyor —
   * sonucu da yazmadan o kayıt bir şey anlatmıyor.
   */
  lastAssistantText: string | null
}

const EDIT_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit', 'MultiEdit'])
const COMMIT_RE = /\bgit\s+(?:-C\s+\S+\s+)?commit\b/

/**
 * Transcript'teki "user" satırlarının hepsi kullanıcının yazdığı şey değil:
 * harness kesinti bildirimleri, görsel yer tutucuları, sistem hatırlatmaları ve
 * slash-komut sarmalayıcıları da aynı kanaldan geçiyor.
 */
const NOISE_PREFIXES = [
  '[Request interrupted',
  '[Image:',
  '<',
  'Caveat:',
  'No response requested',
  'API Error',
]

function isNoise(text: string): boolean {
  return NOISE_PREFIXES.some((prefix) => text.startsWith(prefix))
}

function textFromContent(content: unknown): string[] {
  if (typeof content === 'string') return [content]
  if (!Array.isArray(content)) return []
  const out: string[] = []
  for (const block of content) {
    if (block && typeof block === 'object') {
      const record = block as Record<string, unknown>
      if (record.type === 'text' && typeof record.text === 'string') out.push(record.text)
    }
  }
  return out
}

export async function readTranscript(transcriptPath: string): Promise<TranscriptSummary> {
  const summary: TranscriptSummary = {
    title: null,
    prompts: [],
    files: [],
    commits: [],
    firstTimestamp: null,
    lastTimestamp: null,
    cwd: null,
    branch: null,
    sessionId: null,
    promptCount: 0,
    lastAssistantText: null,
  }
  const seenFiles = new Set<string>()

  const stream = createInterface({ input: createReadStream(transcriptPath, 'utf8') })
  for await (const line of stream) {
    if (!line.trim()) continue
    let record: Record<string, unknown>
    try {
      record = JSON.parse(line) as Record<string, unknown>
    } catch {
      continue
    }

    if (!summary.firstTimestamp && typeof record.timestamp === 'string') {
      summary.firstTimestamp = record.timestamp
    }
    if (typeof record.timestamp === 'string') summary.lastTimestamp = record.timestamp
    if (!summary.cwd && typeof record.cwd === 'string') summary.cwd = record.cwd
    if (!summary.branch && typeof record.gitBranch === 'string') summary.branch = record.gitBranch
    if (!summary.sessionId && typeof record.sessionId === 'string') {
      summary.sessionId = record.sessionId
    }

    const type = record.type
    if (type === 'ai-title' && typeof record.aiTitle === 'string') {
      summary.title = record.aiTitle
      continue
    }

    // Yan-dal (subagent) mesajları kullanıcının isteği değildir.
    if (type === 'user' && !record.isMeta && !record.isSidechain) {
      const message = record.message as Record<string, unknown> | undefined
      for (const chunk of textFromContent(message?.content)) {
        const trimmed = chunk.trim()
        if (!trimmed || isNoise(trimmed)) continue
        summary.promptCount += 1
        // Arka arkaya gelen aynı istek ("devam et") bir kez yazılır.
        if (summary.prompts.at(-1) === trimmed) continue
        summary.prompts.push(trimmed)
      }
      continue
    }

    if (type === 'assistant') {
      const message = record.message as Record<string, unknown> | undefined
      const content = message?.content
      if (!Array.isArray(content)) continue
      if (!record.isSidechain) {
        const texts = textFromContent(content)
          .map((text) => text.trim())
          .filter(Boolean)
        const last = texts.at(-1)
        if (last) summary.lastAssistantText = last
      }
      for (const block of content) {
        if (!block || typeof block !== 'object') continue
        const inner = block as Record<string, unknown>
        if (inner.type !== 'tool_use') continue
        const name = typeof inner.name === 'string' ? inner.name : ''
        const input = (inner.input ?? {}) as Record<string, unknown>

        if (EDIT_TOOLS.has(name) && typeof input.file_path === 'string') {
          if (!seenFiles.has(input.file_path)) {
            seenFiles.add(input.file_path)
            summary.files.push(input.file_path)
          }
        }
        if (name === 'Bash' && typeof input.command === 'string' && COMMIT_RE.test(input.command)) {
          summary.commits.push(truncate(input.command, 80))
        }
      }
    }
  }
  return summary
}

/** Oturum bir şey değiştirdi mi — kayıt eşiği bu. */
export function sessionChanged(summary: TranscriptSummary): boolean {
  return summary.files.length > 0 || summary.commits.length > 0
}

export function sessionDraft(summary: TranscriptSummary, fallbackCwd: string): EntryDraft {
  const cwd = summary.cwd ?? fallbackCwd
  const repo = repoInfo(cwd)
  // git `C:/…` döndürür, transcript `C:\…` taşır: düz `startsWith` Windows'ta
  // hiç eşleşmez ve kullanıcı adını içeren mutlak yollar deftere düşerdi.
  const relative = (file: string): string => {
    if (!repo) return file
    const rel = path.relative(path.resolve(repo.root), path.resolve(file))
    return rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? rel.split(path.sep).join('/') : file
  }
  // Önce maskele, sonra kes: kesmek bir özel anahtarın END satırını atarsa
  // desen eşleşmez ve anahtarın gövdesi deftere düşer.
  const safe = (text: string, max: number): string => truncate(redact(text).text, max)

  const sections: string[] = []
  if (summary.prompts.length > 0) {
    sections.push('**Ne istendi:**', '')
    for (const prompt of summary.prompts.slice(0, 12)) {
      sections.push(`- ${safe(prompt, 220)}`)
    }
    if (summary.prompts.length > 12) {
      sections.push(`- …ve ${summary.prompts.length - 12} istek daha`)
    }
    sections.push('')
  }
  if (summary.files.length > 0) {
    sections.push(`**Dokunulan dosyalar (${summary.files.length}):**`, '')
    for (const file of summary.files.slice(0, 25)) sections.push(`- \`${relative(file)}\``)
    if (summary.files.length > 25) sections.push(`- …ve ${summary.files.length - 25} dosya daha`)
    sections.push('')
  }
  if (summary.commits.length > 0) {
    sections.push(`**Commit çağrıları:** ${summary.commits.length}`, '')
  }
  // Konuşma oturumlarında sonucu da yaz: "ne sordum" tek başına bir kayıt değil.
  if (summary.files.length === 0 && summary.commits.length === 0 && summary.lastAssistantText) {
    sections.push('**Sonuç:**', '', safe(summary.lastAssistantText, 700), '')
  }
  if (summary.sessionId) sections.push(marker('oturum', summary.sessionId))

  const title = summary.title ?? `Claude oturumu — ${repo?.name ?? path.basename(cwd)}`

  return {
    title: truncate(title, 120),
    type: 'devlog',
    // Transcript her şeyi taşır: .env dökümleri, tokenlar, PoC'ler.
    body: redact(sections.join('\n')).text,
    occurred_at: summary.firstTimestamp ?? undefined,
    project: repo?.name,
    tags: [repo?.name, summary.branch ?? repo?.branch, 'claude-oturum'].filter(
      (value): value is string => Boolean(value),
    ),
    refs: { files: summary.files.slice(0, 25).map(relative) },
  }
}

/** `~/.claude/projects/<proje>/*.jsonl` — tüm oturum transcript'leri. */
export async function listTranscripts(): Promise<string[]> {
  const root = path.join(os.homedir(), '.claude', 'projects')
  const found: string[] = []
  let projects: string[]
  try {
    projects = (await fs.readdir(root, { withFileTypes: true }))
      .filter((item) => item.isDirectory())
      .map((item) => item.name)
  } catch {
    return []
  }
  for (const project of projects) {
    const dir = path.join(root, project)
    let files: string[]
    try {
      files = await fs.readdir(dir)
    } catch {
      continue
    }
    for (const file of files) {
      if (file.endsWith('.jsonl')) found.push(path.join(dir, file))
    }
  }
  return found.sort()
}
