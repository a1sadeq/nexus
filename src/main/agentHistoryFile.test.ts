import {
  mkdtempSync,
  rmSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  symlinkSync,
  statSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AgentHistoryFile } from './agentHistoryFile'
import { AgentHistory } from './agentHistory'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nexus-history-test-'))
})
afterEach(() => {
  rmSync(dir, { force: true, recursive: true })
})
const key = (id: string): string => createHash('sha256').update(id).digest('hex')

describe('dedicated plaintext history file adapter', () => {
  it('persists and reopens isolated project history without backups', () => {
    const file = new AgentHistoryFile(dir, 'project'),
      history = new AgentHistory(file, () => 100)
    history.append({ kind: 'content', category: 'conversation', text: 'hello' })
    history.append({
      kind: 'sensitive-transfer',
      direction: 'to-agent',
      outcome: 'approved',
      byteCount: 5
    })
    file.close()
    expect(readdirSync(dir)).toEqual([`${key('project')}.json`])
    const reopened = new AgentHistoryFile(dir, 'project'),
      loaded = new AgentHistory(reopened, () => 100)
    expect(loaded.records()).toHaveLength(2)
    const other = new AgentHistoryFile(dir, 'other')
    expect(new AgentHistory(other, () => 100).records()).toEqual([])
    other.close()
    reopened.close()
  })
  it('prevents a second writer and releases the lock when closed', () => {
    const first = new AgentHistoryFile(dir, 'project')
    expect(() => new AgentHistoryFile(dir, 'project')).toThrow('locked')
    first.close()
    first.close()
    expect(() => first.read()).toThrow('closed')
    const next = new AgentHistoryFile(dir, 'project')
    next.close()
  })
  it('refuses a symlink at the history file instead of reading its target', () => {
    const external = join(dir, 'external'),
      file = join(dir, `${key('project')}.json`)
    writeFileSync(external, 'private')
    symlinkSync(external, file)
    const store = new AgentHistoryFile(dir, 'project')
    expect(() => store.read()).toThrow('History read failed')
    expect(readFileSync(external, 'utf8')).toBe('private')
    store.close()
  })
  it('retention rewrites only the active file and creates no backups', () => {
    let now = 100
    const store = new AgentHistoryFile(dir, 'project'),
      history = new AgentHistory(store, () => now)
    history.append({ kind: 'content', category: 'actions', text: 'expired-content' })
    now += 16 * 86400000
    history.prune()
    expect(readFileSync(join(dir, `${key('project')}.json`), 'utf8')).not.toContain(
      'expired-content'
    )
    store.close()
    expect(readdirSync(dir)).toEqual([`${key('project')}.json`])
  })
  it('removes only matching orphan temporary files in the dedicated directory', () => {
    const prefix = `${key('project')}.tmp-`,
      orphan = `${prefix}11111111-1111-4111-8111-111111111111`
    writeFileSync(join(dir, orphan), 'old')
    writeFileSync(join(dir, 'unrelated.txt'), 'keep')
    const store = new AgentHistoryFile(dir, 'project')
    expect(readdirSync(dir)).not.toContain(orphan)
    expect(readFileSync(join(dir, 'unrelated.txt'), 'utf8')).toBe('keep')
    store.close()
  })
  it('fails closed on a symlinked temporary file without removing its target', () => {
    const external = join(dir, 'external'),
      orphan = `${key('project')}.tmp-11111111-1111-4111-8111-111111111111`
    writeFileSync(external, 'keep')
    symlinkSync(external, join(dir, orphan))
    expect(() => new AgentHistoryFile(dir, 'project')).toThrow('cleanup failed')
    expect(readFileSync(external, 'utf8')).toBe('keep')
  })
  it('does not silently overwrite malformed data during read', () => {
    const path = join(dir, `${key('project')}.json`)
    writeFileSync(path, '{bad')
    const store = new AgentHistoryFile(dir, 'project')
    expect(() => new AgentHistory(store, () => 1)).toThrow('read failed')
    expect(readFileSync(path, 'utf8')).toBe('{bad')
    store.close()
  })
  it('rejects relative or symlinked directories', () => {
    expect(() => new AgentHistoryFile('relative', 'project')).toThrow()
    const link = `${dir}-link`
    symlinkSync(dir, link)
    try {
      expect(() => new AgentHistoryFile(link, 'project')).toThrow()
    } finally {
      rmSync(link, { force: true })
    }
  })
  it('fails closed for a stale lock instead of assuming its owner is dead', () => {
    const lock = join(dir, `${key('project')}.lock`)
    writeFileSync(lock, '')
    expect(() => new AgentHistoryFile(dir, 'project')).toThrow('locked')
    expect(readdirSync(dir)).toContain(`${key('project')}.lock`)
  })
  it('rejects oversized and invalid UTF-8 history without overwriting it', () => {
    const path = join(dir, `${key('project')}.json`)
    writeFileSync(path, Buffer.from([0xff, 0xfe]))
    const store = new AgentHistoryFile(dir, 'project')
    expect(() => store.read()).toThrow('read failed')
    writeFileSync(path, Buffer.alloc(8 * 1024 * 1024 + 1))
    expect(() => store.read()).toThrow('read failed')
    store.close()
  })
  it('persists independent project policies and applies retention on reopen', () => {
    let now = 100
    const a = new AgentHistoryFile(dir, 'project-a'),
      b = new AgentHistoryFile(dir, 'project-b')
    const ha = new AgentHistory(a, () => now),
      hb = new AgentHistory(b, () => now)
    ha.configure({ retentionDays: 1, categories: ['reviews'] })
    hb.configure({ retentionDays: 30, categories: ['actions'] })
    ha.append({ kind: 'content', category: 'reviews', text: 'a-old' })
    hb.append({ kind: 'content', category: 'actions', text: 'b-old' })
    a.close()
    b.close()
    now += 2 * 86400000
    const ar = new AgentHistoryFile(dir, 'project-a'),
      br = new AgentHistoryFile(dir, 'project-b')
    const loadedA = new AgentHistory(ar, () => now),
      loadedB = new AgentHistory(br, () => now)
    expect(loadedA.policy().categories).toEqual(['reviews'])
    expect(loadedA.records()).toEqual([])
    expect(loadedB.records()).toHaveLength(1)
    ar.close()
    br.close()
  })
  it('uses hashed project filenames and restrictive POSIX file permissions', () => {
    const store = new AgentHistoryFile(dir, 'private-project-name')
    new AgentHistory(store, () => 1).append({ kind: 'content', category: 'actions', text: 'x' })
    store.close()
    const files = readdirSync(dir)
    expect(files).toEqual([`${key('private-project-name')}.json`])
    expect(files.join()).not.toContain('private-project-name')
    // This test is meaningful on POSIX; platform behavior still needs verification.
    if (process.platform !== 'win32') {
      const { mode } = statSync(join(dir, files[0]))
      expect(mode & 0o077).toBe(0)
    }
  })
  it('never removes similarly named files that are not exact generated temp names', () => {
    const prefix = `${key('project')}.tmp-`
    const names = [
      `${prefix}11111111-1111-4111-8111-111111111111\n`,
      `${prefix}11111111-1111-1111-1111-111111111111`
    ]
    names.forEach((name) => writeFileSync(join(dir, name), 'keep'))
    const store = new AgentHistoryFile(dir, 'project')
    for (const name of names) expect(readFileSync(join(dir, name), 'utf8')).toBe('keep')
    store.close()
  })
  it('refuses to replace a symlink at the history target when writing', () => {
    const external = join(dir, 'external'),
      path = join(dir, `${key('project')}.json`)
    writeFileSync(external, 'keep')
    symlinkSync(external, path)
    const store = new AgentHistoryFile(dir, 'project')
    expect(() => store.write({ value: 'new' })).toThrow('target unavailable')
    expect(readFileSync(external, 'utf8')).toBe('keep')
    expect(readFileSync(path, 'utf8')).toBe('keep')
    store.close()
  })
})
