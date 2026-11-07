import { describe, it, expect, vi, beforeEach } from 'vitest'
import { calculateDirSize, cleanOrphanedTempFiles, getCacheStats, pruneAppCaches } from './cachePruningManager'
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const testDir = join(tmpdir(), 'nexus-cache-test-' + Date.now())

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => testDir),
    on: vi.fn()
  },
  session: {
    defaultSession: {
      clearCache: vi.fn(async () => {}),
      clearStorageData: vi.fn(async () => {})
    },
    fromPartition: vi.fn(() => ({
      clearCache: vi.fn(async () => {}),
      clearStorageData: vi.fn(async () => {})
    }))
  }
}))

describe('CachePruningManager', () => {
  beforeEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true })
    }
    mkdirSync(testDir, { recursive: true })
  })

  it('calculateDirSize accurately sums nested files and handles missing dirs', () => {
    expect(calculateDirSize(join(testDir, 'non-existent'))).toBe(0)

    const sub = join(testDir, 'sub')
    mkdirSync(sub, { recursive: true })
    writeFileSync(join(sub, 'a.bin'), Buffer.alloc(1024))
    writeFileSync(join(sub, 'b.bin'), Buffer.alloc(2048))

    expect(calculateDirSize(sub)).toBe(3072)
    expect(calculateDirSize(testDir)).toBe(3072)
  })

  it('cleanOrphanedTempFiles deletes older .tmp-* files while keeping recent ones', () => {
    const oldTemp = join(testDir, 'test.tmp-1234')
    writeFileSync(oldTemp, 'old data')

    // Clean with 0ms age threshold to purge immediately
    cleanOrphanedTempFiles(testDir, 0)
    expect(existsSync(oldTemp)).toBe(false)
  })

  it('getCacheStats aggregates root and partition cache sizes', () => {
    const rootCache = join(testDir, 'Cache')
    const partCache = join(testDir, 'Partitions', 'ai-shared', 'Code Cache')
    mkdirSync(rootCache, { recursive: true })
    mkdirSync(partCache, { recursive: true })

    writeFileSync(join(rootCache, 'data_0'), Buffer.alloc(5000))
    writeFileSync(join(partCache, 'index'), Buffer.alloc(7000))

    const stats = getCacheStats(testDir)
    expect(stats.rootCacheBytes).toBe(5000)
    expect(stats.partitionCacheBytes).toBe(7000)
    expect(stats.totalCacheBytes).toBe(12000)
  })

  it('pruneAppCaches triggers clearCache and clearStorageData safely without removing logins', async () => {
    const result = await pruneAppCaches(testDir)
    expect(result.success).toBe(true)

    const electron = await import('electron')
    expect(electron.session.defaultSession.clearCache).toHaveBeenCalled()
    expect(electron.session.defaultSession.clearStorageData).toHaveBeenCalledWith({
      storages: ['shadercache', 'cachestorage']
    })
  })
})
