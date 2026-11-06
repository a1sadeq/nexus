import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const testDir = join('/tmp', `nexus-atomic-test-${Date.now()}`)

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => testDir),
    on: vi.fn()
  }
}))

describe('Atomic Storage & Backup Recovery Engine (T-A9, T-A10)', () => {
  let atomicWriteJson: any
  let readJson: any
  let scheduleWrite: any
  let flushState: any

  beforeEach(async () => {
    if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true })
    mkdirSync(testDir, { recursive: true })

    vi.useFakeTimers()
    const atomicMod = await import('./atomicWrite')
    atomicWriteJson = atomicMod.atomicWriteJson
    readJson = atomicMod.readJson
    scheduleWrite = atomicMod.scheduleWrite
    flushState = atomicMod.flushState
  })

  afterEach(() => {
    vi.useRealTimers()
    if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true })
  })

  it('T-A10: rotates .bak to .bak2 across writes and recovers from .bak if main is corrupt', () => {
    const target = join(testDir, 'test-state.json')

    // First write: version 1
    atomicWriteJson(target, { v: 1 })
    expect(existsSync(target)).toBe(true)
    expect(readJson(target)).toEqual({ v: 1 })

    // Second write: version 2 (target becomes v2, .bak becomes v1)
    atomicWriteJson(target, { v: 2 })
    expect(existsSync(`${target}.bak`)).toBe(true)
    expect(JSON.parse(readFileSync(`${target}.bak`, 'utf-8'))).toEqual({ v: 1 })

    // Third write: version 3 (.bak becomes v2, .bak2 becomes v1)
    atomicWriteJson(target, { v: 3 })
    expect(existsSync(`${target}.bak2`)).toBe(true)
    expect(JSON.parse(readFileSync(`${target}.bak2`, 'utf-8'))).toEqual({ v: 1 })
    expect(JSON.parse(readFileSync(`${target}.bak`, 'utf-8'))).toEqual({ v: 2 })

    // Corrupt main file
    writeFileSync(target, 'CORRUPTED JSON DATA! {{{', 'utf-8')

    // Recovery ladder: readJson falls back to .bak (v2)
    const recovered = readJson(target)
    expect(recovered).toEqual({ v: 2 })

    // If both main and .bak are corrupt, falls back to .bak2 (v1)
    writeFileSync(`${target}.bak`, 'CORRUPT BAK {{{', 'utf-8')
    const recovered2 = readJson(target)
    expect(recovered2).toEqual({ v: 1 })
  })

  it('T-A9: debounces trailing writes and flushes immediately on leading edge or quit', () => {
    // Leading-edge write: lands immediately on disk
    scheduleWrite('theme', { activeId: 'theme-1' })
    const themePath = join(testDir, 'theme.json')
    expect(existsSync(themePath)).toBe(true)
    expect(readJson(themePath)).toEqual({ activeId: 'theme-1' })

    // Subsequent trailing writes: coalesced
    scheduleWrite('theme', { activeId: 'theme-2' })
    scheduleWrite('theme', { activeId: 'theme-3' })

    // Before timer fires, disk still has initial write
    expect(readJson(themePath)).toEqual({ activeId: 'theme-1' })

    // flushState() synchronously flushes all pending trailing writes (as on app before-quit)
    flushState()
    expect(readJson(themePath)).toEqual({ activeId: 'theme-3' })
  })
})
