import { session, app } from 'electron'
import { join } from 'node:path'
import { readdirSync, statSync, rmSync, existsSync } from 'node:fs'

export interface CacheStats {
  rootCacheBytes: number
  partitionCacheBytes: number
  totalCacheBytes: number
  totalCacheMB: number
  processMemoryMB: number
  heapUsedMB: number
}

export interface PruneResult {
  success: boolean
  freedBytes: number
  freedMB: number
  currentCacheBytes: number
  currentCacheMB: number
  error?: string
}

/**
 * Recursively computes the total size of a directory in bytes.
 * Safely handles symlinks, missing paths, and access errors.
 */
export function calculateDirSize(dirPath: string): number {
  if (!existsSync(dirPath)) return 0
  let total = 0
  try {
    const entries = readdirSync(dirPath, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = join(dirPath, entry.name)
      try {
        if (entry.isDirectory()) {
          total += calculateDirSize(fullPath)
        } else if (entry.isFile()) {
          const st = statSync(fullPath)
          total += st.size
        }
      } catch {
        // Skip inaccessible entries
      }
    }
  } catch {
    // Skip unreadable directories
  }
  return total
}

const CACHE_SUBDIRS = [
  'Cache',
  'Code Cache',
  'GPUCache',
  'DawnGraphiteCache',
  'DawnWebGPUCache'
]

/**
 * Returns disk and memory usage stats across root and partition caches.
 */
export function getCacheStats(userDataDir: string = app.getPath('userData')): CacheStats {
  let rootCacheBytes = 0
  for (const sub of CACHE_SUBDIRS) {
    rootCacheBytes += calculateDirSize(join(userDataDir, sub))
  }

  let partitionCacheBytes = 0
  const partitionDir = join(userDataDir, 'Partitions', 'ai-shared')
  for (const sub of CACHE_SUBDIRS) {
    partitionCacheBytes += calculateDirSize(join(partitionDir, sub))
  }

  const totalCacheBytes = rootCacheBytes + partitionCacheBytes
  const mem = process.memoryUsage()

  return {
    rootCacheBytes,
    partitionCacheBytes,
    totalCacheBytes,
    totalCacheMB: Math.round((totalCacheBytes / (1024 * 1024)) * 10) / 10,
    processMemoryMB: Math.round((mem.rss / (1024 * 1024)) * 10) / 10,
    heapUsedMB: Math.round((mem.heapUsed / (1024 * 1024)) * 10) / 10
  }
}

/**
 * Cleans orphaned temporary files (.tmp-* or .tmp.*) older than maxAgeMs.
 */
export function cleanOrphanedTempFiles(userDataDir: string = app.getPath('userData'), maxAgeMs: number = 3600_000): void {
  if (!existsSync(userDataDir)) return
  const now = Date.now()
  try {
    const files = readdirSync(userDataDir)
    for (const file of files) {
      if (file.includes('.tmp-') || file.includes('.tmp.')) {
        const fullPath = join(userDataDir, file)
        try {
          const st = statSync(fullPath)
          if (now - st.mtimeMs >= maxAgeMs) {
            rmSync(fullPath, { recursive: true, force: true })
          }
        } catch {
          // Ignored
        }
      }
    }
  } catch {
    // Ignored
  }
}

/**
 * Purges transient network and shader caches while STRICTLY preserving
 * cookies, local storage, indexeddb, and user credentials.
 */
export async function pruneAppCaches(userDataDir: string = app.getPath('userData')): Promise<PruneResult> {
  const beforeStats = getCacheStats(userDataDir)

  try {
    // 1. Clear Chromium HTTP network cache on default and AI session
    const defaultSess = session.defaultSession
    if (defaultSess) {
      try {
        await defaultSess.clearCache()
        // Only clear transient caches — strictly NEVER clear cookies, localstorage, websql, indexeddb
        await defaultSess.clearStorageData({
          storages: ['shadercache', 'cachestorage']
        })
      } catch (err) {
        console.warn('[CachePruner] defaultSession clear error:', err)
      }
    }

    const aiSess = session.fromPartition('persist:ai-shared')
    if (aiSess) {
      try {
        await aiSess.clearCache()
        // Only clear transient caches — strictly NEVER clear cookies, localstorage, websql, indexeddb
        await aiSess.clearStorageData({
          storages: ['shadercache', 'cachestorage']
        })
      } catch (err) {
        console.warn('[CachePruner] aiSession clear error:', err)
      }
    }

    // 2. Clean temporary files in userData
    cleanOrphanedTempFiles(userDataDir)

    const afterStats = getCacheStats(userDataDir)
    const freedBytes = Math.max(0, beforeStats.totalCacheBytes - afterStats.totalCacheBytes)

    return {
      success: true,
      freedBytes,
      freedMB: Math.round((freedBytes / (1024 * 1024)) * 10) / 10,
      currentCacheBytes: afterStats.totalCacheBytes,
      currentCacheMB: afterStats.totalCacheMB
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[CachePruner] Prune failed:', err)
    return {
      success: false,
      freedBytes: 0,
      freedMB: 0,
      currentCacheBytes: beforeStats.totalCacheBytes,
      currentCacheMB: beforeStats.totalCacheMB,
      error: msg
    }
  }
}

let startupPruneScheduled = false

/**
 * Automatically sets up non-blocking startup and exit cache maintenance.
 */
export function scheduleStartupAndExitPruning(userDataDir?: string): void {
  if (startupPruneScheduled) return
  startupPruneScheduled = true

  // Run non-blocking prune 5 seconds after launch to clean stale caches from prior session
  const timer = setTimeout(() => {
    pruneAppCaches(userDataDir).catch((err) => {
      console.warn('[CachePruner] Startup prune error:', err)
    })
  }, 5000)

  if (timer.unref) {
    timer.unref()
  }

  // Also clean up on app exit
  app.on('before-quit', () => {
    pruneAppCaches(userDataDir).catch(() => {})
  })
}
