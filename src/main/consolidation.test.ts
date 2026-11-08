import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  utimesSync,
  writeFileSync
} from 'node:fs'
import { join } from 'node:path'
import { consolidateLegacyConfigDir } from './migrations/consolidateLegacyConfigDir'

const testRoot = join('/tmp', `nexus-consolidation-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => testRoot)
  }
}))

describe('Legacy Config Directory Archive Consolidation (T-A4, T-A5, T-A6)', () => {
  const legacyDir = join(testRoot, 'Nexus')
  const liveDir = join(testRoot, 'nexus')

  beforeEach(() => {
    if (existsSync(testRoot)) rmSync(testRoot, { recursive: true, force: true })
    mkdirSync(legacyDir, { recursive: true })
    mkdirSync(liveDir, { recursive: true })
  })

  afterEach(() => {
    if (existsSync(testRoot)) rmSync(testRoot, { recursive: true, force: true })
  })

  it('T-A4: migrates unique files (shortcuts.json) and resolves conflicts using newer mtime', () => {
    // 1. Unique file in legacy
    writeFileSync(join(legacyDir, 'shortcuts.json'), JSON.stringify({ key: 'custom' }), 'utf-8')

    // 2. Conflicting file: live is older, legacy is newer
    const nowSec = Math.floor(Date.now() / 1000)
    writeFileSync(join(liveDir, 'conflict.json'), JSON.stringify({ v: 'live-older' }), 'utf-8')
    utimesSync(join(liveDir, 'conflict.json'), nowSec - 100, nowSec - 100)

    writeFileSync(join(legacyDir, 'conflict.json'), JSON.stringify({ v: 'legacy-newer' }), 'utf-8')
    utimesSync(join(legacyDir, 'conflict.json'), nowSec, nowSec)

    consolidateLegacyConfigDir(testRoot)

    // shortcuts.json migrated to live
    expect(existsSync(join(liveDir, 'shortcuts.json'))).toBe(true)
    expect(JSON.parse(readFileSync(join(liveDir, 'shortcuts.json'), 'utf-8'))).toEqual({
      key: 'custom'
    })

    // Newer legacy conflict won
    expect(JSON.parse(readFileSync(join(liveDir, 'conflict.json'), 'utf-8'))).toEqual({
      v: 'legacy-newer'
    })

    // Loser was archived, legacy directory remainder was archived (not deleted)
    expect(existsSync(legacyDir)).toBe(false)
    const archivedDirs = readdirSync(testRoot).filter((d) => d.startsWith('Nexus.archived-'))
    expect(archivedDirs.length).toBeGreaterThan(0)
    expect(existsSync(join(liveDir, 'migration-v1.log'))).toBe(true)
  })

  it('T-A5: archives legacy Partitions and SingletonLock without merging over live cookies', () => {
    mkdirSync(join(legacyDir, 'Partitions'), { recursive: true })
    writeFileSync(join(legacyDir, 'SingletonLock'), '', 'utf-8')
    writeFileSync(join(legacyDir, 'Partitions', 'stale.txt'), 'old-august-data', 'utf-8')

    mkdirSync(join(liveDir, 'Partitions'), { recursive: true })
    writeFileSync(join(liveDir, 'Partitions', 'live.txt'), 'live-active-cookies', 'utf-8')

    consolidateLegacyConfigDir(testRoot)

    // Live partition untouched
    expect(existsSync(join(liveDir, 'Partitions', 'live.txt'))).toBe(true)
    expect(existsSync(join(liveDir, 'Partitions', 'stale.txt'))).toBe(false)

    // Stale partition was archived
    const archiveRoot = readdirSync(testRoot).find(
      (d) => d.startsWith('Nexus.archived-') && !d.endsWith('.remainder')
    )
    expect(archiveRoot).toBeDefined()
    expect(existsSync(join(testRoot, archiveRoot!, 'Partitions', 'stale.txt'))).toBe(true)
    expect(existsSync(join(testRoot, archiveRoot!, 'SingletonLock'))).toBe(true)
  })

  it('T-A6: re-running consolidation is an idempotent no-op', () => {
    consolidateLegacyConfigDir(testRoot)
    // Legacy is already gone
    expect(existsSync(legacyDir)).toBe(false)

    // Second run does nothing and doesn't throw
    expect(() => consolidateLegacyConfigDir(testRoot)).not.toThrow()
  })

  it('T-A7: skips migration safely if legacy and live point to the exact same directory', () => {
    const customRoot = join(testRoot, 'case-alias')
    mkdirSync(customRoot, { recursive: true })
    const singleDir = join(customRoot, 'nexus')
    mkdirSync(singleDir, { recursive: true })
    writeFileSync(join(singleDir, 'active_profile.json'), '{"live":true}', 'utf-8')

    // If Nexus points to nexus (via symlink or same dir), it must be an immediate no-op
    const symlinkLegacy = join(customRoot, 'Nexus')
    try {
      const { symlinkSync } = require('node:fs')
      symlinkSync(singleDir, symlinkLegacy, 'dir')
    } catch {}

    consolidateLegacyConfigDir(customRoot)

    expect(existsSync(join(singleDir, 'active_profile.json'))).toBe(true)
    const archives = readdirSync(customRoot).filter((d) => d.startsWith('Nexus.archived-'))
    expect(archives.length).toBe(0)
  })
})
