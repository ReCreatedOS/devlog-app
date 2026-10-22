#!/usr/bin/env node
/**
 * Claude Code entegrasyonunu kurar: hook'ları ~/.claude/settings.json'a ekler
 * ve MCP sunucusunu kullanıcı kapsamında kaydeder.
 *
 *   node scripts/setup-claude-code.mjs            # kur
 *   node scripts/setup-claude-code.mjs --dry-run  # yalnız ne yapılacağını göster
 *   node scripts/setup-claude-code.mjs --stop-reminder  # isteğe bağlı Stop hatırlatıcısı da
 *
 * Tekrar çalıştırmak güvenlidir: devlog hook'u zaten varsa yolu güncellenir,
 * ikinci kopya eklenmez. settings.json yazılmadan önce yedeklenir.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dry = process.argv.includes('--dry-run')
const withStop = process.argv.includes('--stop-reminder')

const dist = (file) => path.join(repo, 'apps', 'cli', 'dist', file)
const mcpEntry = path.join(repo, 'apps', 'mcp', 'dist', 'devlog-mcp.mjs')
const stopScript = path.join(repo, 'integrations', 'claude-code', 'devlog-stop-reminder.sh')

for (const file of [dist('hook-tool-use.mjs'), dist('hook-session-end.mjs'), mcpEntry]) {
  if (!existsSync(file)) {
    console.error(`Derlenmiş dosya yok: ${file}\nÖnce çalıştır: pnpm build:tools`)
    process.exit(1)
  }
}

const quote = (p) => `"${p}"`
const wanted = [
  { event: 'PostToolUse', matcher: 'Bash', file: 'hook-tool-use.mjs', command: `node ${quote(dist('hook-tool-use.mjs'))}`, timeout: 25 },
  { event: 'SessionEnd', file: 'hook-session-end.mjs', command: `node ${quote(dist('hook-session-end.mjs'))}`, timeout: 40 },
]
if (withStop) {
  wanted.push({ event: 'Stop', file: 'devlog-stop-reminder.sh', command: `bash ${quote(stopScript)}`, timeout: 15 })
}

const settingsPath = path.join(os.homedir(), '.claude', 'settings.json')
let settings = {}
if (existsSync(settingsPath)) {
  try {
    settings = JSON.parse(await fs.readFile(settingsPath, 'utf8'))
  } catch (error) {
    console.error(`${settingsPath} okunamadı (${error.message}). Düzeltip tekrar dene; dosyaya dokunulmadı.`)
    process.exit(1)
  }
}
settings.hooks ??= {}

/** Bu hook grubunun içinde bizim dosyamızı çağıran bir komut var mı? */
const mentions = (group, file) => JSON.stringify(group).includes(file)

for (const hook of wanted) {
  const groups = (settings.hooks[hook.event] ??= [])
  const entry = { type: 'command', command: hook.command, timeout: hook.timeout }
  const existing = groups.find((group) => mentions(group, hook.file))
  if (existing) {
    existing.hooks = (existing.hooks ?? []).map((h) => (mentions(h, hook.file) ? entry : h))
    console.log(`güncellendi  ${hook.event} → ${hook.command}`)
  } else {
    groups.push({ ...(hook.matcher ? { matcher: hook.matcher } : {}), hooks: [entry] })
    console.log(`eklendi      ${hook.event} → ${hook.command}`)
  }
}

if (!dry) {
  await fs.mkdir(path.dirname(settingsPath), { recursive: true })
  if (existsSync(settingsPath)) await fs.copyFile(settingsPath, `${settingsPath}.devlog-yedek-${Date.now()}`)
  await fs.writeFile(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, 'utf8')
  console.log(`yazıldı      ${settingsPath} (yedek alındı)`)
}

const mcpArgs = ['mcp', 'add', '--scope', 'user', 'devlog', '--', 'node', mcpEntry]
if (dry) {
  console.log(`\nMCP: claude ${mcpArgs.join(' ')}`)
} else {
  try {
    execFileSync('claude', mcpArgs, { stdio: 'inherit' })
  } catch {
    console.log(
      '\nMCP sunucusu otomatik kaydedilemedi (claude CLI bulunamadı ya da zaten kayıtlı).\n' +
        `Elle: claude ${mcpArgs.map((a) => (a.includes(' ') ? quote(a) : a)).join(' ')}`,
    )
  }
}

console.log('\nBitti. Doğrulamak için: node apps/cli/dist/devlog.mjs doctor')
