import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { loadWorkspace } from '@devlog/core'
import type { Entry } from '@devlog/core'

/**
 * Claude Code hook'ları için ortak yardımcılar.
 *
 * Tasarım kuralları:
 *  - Hook ASLA oturumu bloklamaz. Ne olursa olsun exit 0.
 *  - stdout sessiz kalır (Claude Code stdout'u JSON çıktı olarak ayrıştırır);
 *    teşhis stderr'e gider.
 *  - Her şey yeniden çalıştırılabilir olmalı: aynı olay iki kez gelirse
 *    ikinci kez kayıt üretilmez (işaretleyici ile tekilleştirme).
 */

export interface HookPayload {
  session_id?: string
  transcript_path?: string
  cwd?: string
  hook_event_name?: string
  tool_name?: string
  tool_input?: Record<string, unknown>
  tool_response?: unknown
  reason?: string
}

export async function readHookPayload(): Promise<HookPayload> {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer)
  const raw = Buffer.concat(chunks).toString('utf8').trim()
  if (!raw) return {}
  try {
    return JSON.parse(raw) as HookPayload
  } catch {
    return {}
  }
}

export function note(message: string): void {
  process.stderr.write(`[devlog-hook] ${message}\n`)
}

/** Hook hiçbir koşulda oturumu bozmaz — hata olsa bile temiz çıkarız. */
export function runHook(main: () => Promise<void>): void {
  main()
    .catch((error: unknown) => {
      note(`hata: ${error instanceof Error ? error.message : String(error)}`)
    })
    .finally(() => {
      process.exit(0)
    })
}

export function git(cwd: string, args: string[]): string | null {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return null
  }
}

export interface RepoInfo {
  root: string
  name: string
  branch: string | null
}

export function repoInfo(cwd: string): RepoInfo | null {
  const root = git(cwd, ['rev-parse', '--show-toplevel'])
  if (!root) return null
  return {
    root,
    name: path.basename(root),
    branch: git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']),
  }
}

/**
 * Aynı olayın ikinci kez kaydedilmesini engeller.
 *
 * İşaretleyici kaydın gövdesine gömülür (commit SHA'sı ya da oturum id'si).
 * PostToolUse `git commit --amend`te tekrar tetiklenir, SessionEnd oturum
 * devam ettirilirse yeniden ateşlenir — ikisinde de mükerrer kayıt istemeyiz.
 */
export async function findLogged(marker: string): Promise<Entry | null> {
  // Tüm yazılabilir kayıtlar taranır, son N değil: sabit bir pencere, her
  // commit'i kaydeden yoğun bir defterde devam ettirilen oturumları ve eski
  // commit'leri yeniden kaydettirirdi. Hepsi zaten bellekte.
  const { entries } = await loadWorkspace()
  return entries.find((entry) => !entry.readOnly && entry.body.includes(marker)) ?? null
}

export async function alreadyLogged(marker: string): Promise<boolean> {
  return (await findLogged(marker)) !== null
}

/** Gövdenin sonuna gömülen, gözle görünür ama gürültüsüz izleme etiketi. */
export function marker(kind: string, value: string): string {
  return `<sub>${kind}: ${value}</sub>`
}

export function truncate(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length <= max ? flat : `${flat.slice(0, max).trimEnd()}…`
}
