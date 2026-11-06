// src/main/migrations/consolidateLegacyConfigDir.ts
import { app } from 'electron'
import {
  appendFileSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  renameSync,
  statSync
} from 'node:fs'
import { join } from 'node:path'

const SINGLETON = new Set(['SingletonLock', 'SingletonCookie', 'SingletonSocket'])

/**
 * Consolidates legacy ~/.config/Nexus into ~/.config/nexus safely:
 * - Archives dead singleton symlinks and stale August partitions without overwriting the live cookie jar.
 * - Migrates unique files (e.g. shortcuts.json).
 * - On conflict, keeps the newer mtime and archives the loser (never deletes).
 * - Archives the legacy directory as Nexus.archived-<stamp> (reversible, zero data loss).
 * - Writes an audit trail to ~/.config/nexus/migration-v1.log.
 */
export function consolidateLegacyConfigDir(customAppData?: string): void {
  const appData = customAppData || app.getPath('appData')
  const legacy = join(appData, 'Nexus')
  const live = join(appData, 'nexus')
  if (!existsSync(legacy) || legacy === live) return // Idempotent no-op

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
