// src/main/migrations/consolidateLegacyConfigDir.ts
import { app } from 'electron'
import {
  appendFileSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  realpathSync,
  renameSync,
  statSync
} from 'node:fs'
import { join } from 'node:path'

const SINGLETON = new Set(['SingletonLock', 'SingletonCookie', 'SingletonSocket'])

/**
 * Checks whether two paths refer to the exact same filesystem directory or file.
 * Handles case-insensitive filesystems (Windows, macOS) and hardlink/symlink aliases.
 */
export function isSameDirectory(p1: string, p2: string): boolean {
  if (p1 === p2) return true
  try {
    const s1 = statSync(p1)
    const s2 = statSync(p2)
    if (s1.dev === s2.dev && s1.ino === s2.ino && s1.ino !== 0) {
      return true
    }
  } catch {}
  try {
    const r1 = realpathSync.native ? realpathSync.native(p1) : realpathSync(p1)
    const r2 = realpathSync.native ? realpathSync.native(p2) : realpathSync(p2)
    if (r1 === r2) return true
    if (process.platform === 'win32' || process.platform === 'darwin') {
      if (r1.toLowerCase() === r2.toLowerCase()) return true
    }
  } catch {}
  return false
}

/**
 * Consolidates legacy ~/.config/Nexus into ~/.config/nexus safely:
 * - Archives dead singleton symlinks and stale August partitions without overwriting the live cookie jar.
 * - Migrates unique files (e.g. shortcuts.json).
 * - On conflict, keeps the newer mtime and archives the loser (never deletes).
 * - Archives the legacy directory as Nexus.archived-<stamp> (reversible, zero data loss).
 * - Writes an audit trail to ~/.config/nexus/migration-v1.log.
 * - Idempotently skips if legacy and live refer to the same physical directory (e.g. on Windows/macOS case-insensitive volumes).
 */
export function consolidateLegacyConfigDir(customAppData?: string): void {
  const appData = customAppData || app.getPath('appData')
  const legacy = join(appData, 'Nexus')
  const live = join(appData, 'nexus')
  if (!existsSync(legacy)) return // Idempotent no-op

  // Prevent archiving live profile on case-insensitive filesystems or symlinked setups
  if (isSameDirectory(legacy, live)) return

  try {
    if (lstatSync(legacy).isSymbolicLink()) {
      return // Already unified via symlink
    }
  } catch {}

  const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19)
  const archive = join(appData, `Nexus.archived-${stamp}`)
  mkdirSync(archive, { recursive: true })
  mkdirSync(live, { recursive: true })
  const log = (m: string) =>
    appendFileSync(join(live, 'migration-v1.log'), `${new Date().toISOString()}  ${m}\n`)

  for (const entry of readdirSync(legacy)) {
    try {
      // Chromium owns singleton links (dead symlinks) and legacy Partitions are stale from August.
      // The LIVE cookie jar must never be overwritten.
      if (SINGLETON.has(entry) || entry === 'Partitions') {
        renameSync(join(legacy, entry), join(archive, entry))
        log(`archived without merge: ${entry}`)
        continue
      }
      const from = join(legacy, entry)
      const to = join(live, entry)
      if (statSync(from).isDirectory() || (existsSync(to) && statSync(to).isDirectory())) {
        renameSync(from, join(archive, entry))
        log(`archived directory without merge: ${entry}`)
        continue
      }
      if (!existsSync(to)) {
        // Unique file (e.g. shortcuts.json) -> migrate cleanly
        renameSync(from, to)
        log(`migrated: ${entry}`)
      } else {
        // Conflict: keep newer mtime, quarantine loser into archive
        const fromNewer = statSync(from).mtimeMs > statSync(to).mtimeMs
        const loser = fromNewer ? to : from
        copyFileSync(loser, join(archive, entry))
        if (fromNewer) copyFileSync(from, to)
        renameSync(from, join(archive, `${entry}.legacy`))
        log(`conflict: ${entry} - kept ${fromNewer ? 'legacy (newer mtime)' : 'live (newer mtime)'}, loser archived`)
      }
    } catch (err) {
      log(`ERROR on ${entry}: ${String(err)} - left in place`)
    }
  }

  try {
    renameSync(legacy, `${archive}.remainder`)
    log('remainder archived')
  } catch {}
}
