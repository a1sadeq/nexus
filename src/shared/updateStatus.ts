/**
 * What Settings shows about updates.
 *
 * `ready` is its own phase on purpose. The app used to jump from "downloading" straight to
 * "installing" and restart itself the moment a download finished, which interrupted whatever was
 * being typed. A downloaded update is now a fact the user can act on — restart now, or leave it and it
 * installs when Nexus next quits — so the phase says so, and the timestamps say when the next check and
 * the automatic install are due.
 */
export type UpdatePhase =
  | 'unsupported'
  | 'idle'
  | 'checking'
  | 'downloading'
  | 'ready'
  | 'installing'
  | 'up-to-date'
  | 'error'

export interface UpdateStatus {
  phase: UpdatePhase
  currentVersion: string
  targetVersion?: string
  percent?: number
  message: string
  /** When the last check finished, ms since the epoch. */
  lastCheckedAt?: number
  /** When the next check is due, ms since the epoch. */
  nextCheckAt?: number
  /** When a downloaded update installs itself, ms since the epoch. */
  autoInstallAt?: number
  /** True once the user chose "Later": the update installs on quit, and is not nagged about. */
  deferred?: boolean
  /** Bytes per second, while downloading. */
  bytesPerSecond?: number
}
