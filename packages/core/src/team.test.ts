import { execFileSync } from 'node:child_process'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { DevlogConfig, TeamConfig } from './config.js'
import { cloneTeam, createRoutedEntry, syncTeam, teamForRepo } from './team.js'
import { loadWorkspace } from './workspace.js'

/**
 * Gerçek git ile: bir bare "GitHub" deposu ve iki kişinin klonu. Ağ yok,
 * ama fetch/rebase/push yolunun tamamı gerçekten çalışıyor.
 */

const tmpRoots: string[] = []
let remote = ''
let base = ''

async function makeTmpDir(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix))
  tmpRoots.push(dir)
  return dir
}

function person(name: string, repos?: string[]): { team: TeamConfig; config: DevlogConfig } {
  const team: TeamConfig = { id: 'ekip', label: 'Ekip', root: path.join(base, name, 'ekip'), author: name, repos }
  return { team, config: { vaultRoot: path.join(base, name, 'kisisel'), sources: [], teams: [team] } }
}

async function write(team: TeamConfig, config: DevlogConfig, title: string, body = 'gövde') {
  return createRoutedEntry(config, { title, type: 'devlog', body, team: team.id })
}

beforeAll(async () => {
  base = await makeTmpDir('devlog-team-')
  process.env['DEVLOG_CONFIG'] = path.join(base, 'config', 'config.json')
  for (const [key, value] of Object.entries({
    GIT_AUTHOR_NAME: 'test',
    GIT_AUTHOR_EMAIL: 'test@example.com',
    GIT_COMMITTER_NAME: 'test',
    GIT_COMMITTER_EMAIL: 'test@example.com',
  })) {
    process.env[key] = value
  }
  remote = path.join(base, 'remote.git')
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', remote])
})

afterAll(async () => {
  await Promise.all(tmpRoots.map((dir) => fs.rm(dir, { recursive: true, force: true })))
})

describe('takım vault — git üstünden feed', () => {
  it('boş depoyu kurar; yazılan kayıt itilir, öbür kişide belirir', async () => {
    const a = person('ayse')
    await cloneTeam(remote, a.team.root)
    const { entry } = await write(a.team, a.config, 'Ödeme akışı yeniden yazıldı')
    expect(entry.id).toContain('-ayse-')
    expect(entry.author).toBe('ayse')
    expect(entry.sourceId).toBe('team:ekip')

    const pushed = await syncTeam(a.team)
    expect(pushed.error).toBeUndefined()
    expect(pushed.committed).toBeGreaterThanOrEqual(1)
    expect(pushed.pushed).toBeGreaterThanOrEqual(1)

    const b = person('baris')
    await cloneTeam(remote, b.team.root)
    const { entries } = await loadWorkspace(b.config)
    const seen = entries.find((item) => item.id === entry.id)
    expect(seen?.author).toBe('ayse')
    // Başkasının kaydı: görünür ama düzenlenemez.
    expect(seen?.readOnly).toBe(true)
  })

  it('iki kişi aynı anda yazınca ikisi de kaybolmadan birleşir', async () => {
    const a = person('ayse')
    const b = person('baris')
    const fromA = await write(a.team, a.config, 'A tarafı')
    const fromB = await write(b.team, b.config, 'B tarafı')

    expect((await syncTeam(a.team)).ok).toBe(true)
    const second = await syncTeam(b.team)
    expect(second.error).toBeUndefined()
    expect(second.arrived.some((file) => file.includes('a-tarafi'))).toBe(true)

    const pulled = await syncTeam(a.team)
    expect(pulled.arrived.some((file) => file.includes('b-tarafi'))).toBe(true)

    for (const who of [a, b]) {
      const ids = (await loadWorkspace(who.config)).entries.map((item) => item.id)
      expect(ids).toContain(fromA.entry.id)
      expect(ids).toContain(fromB.entry.id)
    }
  })

  it('sır taşıyan kaydı itmez — maskelemez, BLOKLAR', async () => {
    const a = person('ayse')
    const token = `ghp_${'x'.repeat(36)}`
    const { entry } = await write(a.team, a.config, 'Sızıntı', `token: ${token}`)
    const result = await syncTeam(a.team)
    expect(result.blocked.map((item) => path.basename(item.path))).toContain(path.basename(entry.path))

    const listed = execFileSync('git', ['--git-dir', remote, 'log', '--all', '--name-only', '--format='], {
      encoding: 'utf8',
    })
    expect(listed).not.toContain(path.basename(entry.path))
    await fs.rm(entry.path)
  })

  it('başkasının dosyasını yerelde değiştirmek commit\'lenmez', async () => {
    const b = person('baris')
    const theirs = (await loadWorkspace(b.config)).entries.find((item) => item.author === 'ayse')
    expect(theirs).toBeDefined()
    await fs.appendFile(theirs!.path, '\nelle eklendi\n')
    const result = await syncTeam(b.team)
    expect(result.foreign.map((file) => path.basename(file))).toContain(path.basename(theirs!.path))
    expect(result.committed).toBe(0)
    execFileSync('git', ['-C', b.team.root, 'checkout', '--', '.'])
  })

  it('kişisel vault takıma hiç gitmez; takım verilmezse kişisel', async () => {
    const a = person('ayse')
    const { entry, team } = await createRoutedEntry(a.config, { title: 'Özel not', type: 'note', body: 'x' })
    expect(team).toBeUndefined()
    expect(entry.path.startsWith(a.config.vaultRoot)).toBe(true)
    await expect(
      createRoutedEntry(a.config, { title: 'x', type: 'note', body: 'x', team: 'yok' }),
    ).rejects.toThrow(/Tanınmayan takım/)
  })

  it('commit/deploy yönlendirmesi depo adıyla eşleşir', async () => {
    const repo = path.join(base, 'kod', 'maestro')
    await fs.mkdir(repo, { recursive: true })
    const { config } = person('ayse', ['maestro'])
    expect((await teamForRepo(config, repo))?.id).toBe('ekip')
    expect(await teamForRepo(config, path.join(base, 'kod', 'baska'))).toBeUndefined()
  })
})
