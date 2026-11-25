import type { UpdateStatus } from '../shared/updateStatus'
import {
  UPDATE_CADENCE,
  intervalDelayMs,
  retryDelayMs,
  type UpdateCadence
} from './updateCadence'

export interface UpdateEngine {
  autoDownload: boolean
  autoInstallOnAppQuit: boolean
  allowPrerelease: boolean
  allowDowngrade: boolean
  on(event: string, listener: (...args: any[]) => void): unknown
  removeListener(event: string, listener: (...args: any[]) => void): unknown
  checkForUpdates(): Promise<unknown>
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void
}

export interface Options {
  engine: UpdateEngine
  version: string
  publish: (state: UpdateStatus) => void
  prepareInstall: () => Promise<void>
  installFailed: () => void
  notifyRestart: () => void
  /** A downloaded update is waiting. The app turns this into an OS notification. */
  notifyReady?: (state: UpdateStatus) => void
  cadence?: UpdateCadence
  random?: () => number
  now?: () => number
}

/**
 * One service per main process. Provider pages cannot call the updater.
 *
 * The shape of a session, from launch:
 *
 *   launch ──8 s──▶ check ──┬─ nothing new ──▶ up-to-date ──15 min──▶ check ──▶ …
 *                           ├─ something new ─▶ downloading ─▶ ready ──5 min──▶ install & restart
 *                           └─ failed ────────▶ error ──5,10,20,40,60 min──▶ check
 *
 * A `ready` update installs itself after a grace period, and — because `autoInstallOnAppQuit` is on — on
 * any ordinary quit as well, so choosing "Later" is never the same as losing the update. Nothing here
 * restarts the app the instant a download finishes: that used to interrupt whatever was being typed, and
 * an update is not worth someone's unsent prompt.
 */
export class AutoUpdateService {
  private state: UpdateStatus
  private checking = false
  private installing = false
  private stopped = false
  private started = false
  private failures = 0
  private lastNudgeAt: number | undefined
  private checkTimer: ReturnType<typeof setTimeout> | undefined
  private installTimer: ReturnType<typeof setTimeout> | undefined
  private readonly handlers: Array<[string, (...args: any[]) => void]> = []
  private readonly cadence: UpdateCadence
  private readonly random: () => number
  private readonly now: () => number

  constructor(private readonly opts: Options) {
    this.cadence = opts.cadence ?? UPDATE_CADENCE
    this.random = opts.random ?? Math.random
    this.now = opts.now ?? Date.now
    this.state = {
      phase: 'idle',
      currentVersion: opts.version,
      message: 'Automatic updates enabled.'
    }
    opts.engine.autoDownload = true
    // A downloaded update that the user asked to postpone still applies when Nexus is closed. Before
    // this, "later" meant "never" unless the timer fired.
    opts.engine.autoInstallOnAppQuit = true
    opts.engine.allowPrerelease = false
    opts.engine.allowDowngrade = false
    this.listen('checking-for-update', () => this.update('checking', 'Checking for updates.'))
    this.listen('update-available', (info: { version?: string } | undefined) => {
      this.failures = 0
      this.update('downloading', `Downloading Nexus ${info?.version ?? ''}`.trim() + '.', {
        targetVersion: info?.version,
        percent: 0,
        deferred: false
      })
    })
    this.listen('download-progress', (progress: { percent?: number; bytesPerSecond?: number } | undefined) => {
      const percent = Number(progress?.percent)
      const speed = Number(progress?.bytesPerSecond)
      this.update('downloading', `Downloading Nexus ${this.state.targetVersion ?? ''}`.trim() + '.', {
        percent: Number.isFinite(percent) ? Math.max(0, Math.min(100, percent)) : undefined,
        bytesPerSecond: Number.isFinite(speed) && speed > 0 ? speed : undefined
      })
    })
    this.listen('update-not-available', () => {
      this.failures = 0
      this.update('up-to-date', 'Nexus is up to date.')
    })
    this.listen('error', () => this.fail())
    this.listen('update-downloaded', (info: { version?: string } | undefined) => this.downloaded(info?.version))
  }

  private listen(event: string, listener: (...args: any[]) => void): void {
    this.handlers.push([event, listener])
    this.opts.engine.on(event, listener)
  }

  private update(phase: UpdateStatus['phase'], message: string, extra: Partial<UpdateStatus> = {}): void {
    if (this.stopped) return
    this.state = { ...this.state, ...extra, phase, message }
    this.opts.publish({ ...this.state })
  }

  private busy(): boolean {
    return this.checking || this.installing || this.state.phase === 'downloading' || this.state.phase === 'ready'
  }

  private fail(): void {
    if (this.stopped) return
    if (this.installing) this.opts.installFailed()
    this.installing = false
    this.failures += 1
    this.clearInstallTimer()
    // The reason is deliberately not repeated: updater errors can carry local paths.
    this.update('error', 'Update failed. Nexus will try again shortly.', { percent: undefined })
    this.scheduleCheck(retryDelayMs(this.failures, this.random, this.cadence))
  }

  /** A pending update timer must never be the reason a quitting app stays alive. */
  private unref(timer: ReturnType<typeof setTimeout> | undefined): void {
    if (typeof timer === 'object' && timer && 'unref' in timer) {
      ;(timer as unknown as { unref?: () => void }).unref?.()
    }
  }

  private scheduleCheck(delayMs: number): void {
    if (this.stopped) return
    this.clearCheckTimer()
    const delay = Math.max(0, Math.round(delayMs))
    this.state = { ...this.state, nextCheckAt: this.now() + delay }
    this.opts.publish({ ...this.state })
    this.checkTimer = setTimeout(() => {
      this.checkTimer = undefined
      if (this.stopped) return
      if (this.busy()) {
        // Do not lose the schedule because the moment was inconvenient: try again in a minute. An
        // update that is downloading or waiting to install owns the scheduler until it lands.
        this.scheduleCheck(this.cadence.nudgeThrottleMs)
        return
      }
      void this.check()
    }, delay)
    this.unref(this.checkTimer)
  }

  private clearCheckTimer(): void {
    if (this.checkTimer) clearTimeout(this.checkTimer)
    this.checkTimer = undefined
  }

  private clearInstallTimer(): void {
    if (this.installTimer) clearTimeout(this.installTimer)
    this.installTimer = undefined
  }

  private armAutoInstall(delayMs: number): void {
    this.clearInstallTimer()
    if (this.stopped) return
    const delay = Math.max(0, Math.round(delayMs))
    this.state = { ...this.state, autoInstallAt: this.now() + delay }
    this.opts.publish({ ...this.state })
    this.installTimer = setTimeout(() => {
      this.installTimer = undefined
      this.installNow()
    }, delay)
    this.unref(this.installTimer)
  }

  getStatus(): UpdateStatus {
    return { ...this.state }
  }

  start(): void {
    if (this.stopped || this.started) return
    this.started = true
    this.scheduleCheck(this.cadence.firstCheckDelayMs)
  }

  /**
   * A check the user (or a wake event) asked for: it ignores the current schedule, and forgets past
   * failures — a machine that just came back online deserves a clean attempt.
   */
  async check(): Promise<void> {
    if (this.stopped || this.checking || this.installing) return
    if (this.state.phase === 'downloading' || this.state.phase === 'ready') return
    this.clearCheckTimer()
    this.checking = true
    this.update('checking', 'Checking for updates.', { nextCheckAt: undefined })
    try {
      await this.opts.engine.checkForUpdates()
    } catch {
      this.checking = false
      this.fail()
      return
    }
    this.checking = false
    if (this.stopped) return
    this.failures = 0
    this.state = { ...this.state, lastCheckedAt: this.now() }
    // The engine answers with an event; if it did not (or the download has started already), leave the
    // phase alone.
    if (this.state.phase === 'checking') this.update('up-to-date', 'Nexus is up to date.')
    if (!this.busy()) this.scheduleCheck(intervalDelayMs(this.random, this.cadence))
  }

  /**
   * Something happened that makes a check worth doing now — the machine woke up, the window came back
   * into focus, the network returned. Throttled, so a user alt-tabbing between windows does not turn
   * into a stream of GitHub requests.
   */
  nudge(reason: string): void {
    if (this.stopped || this.installing) return
    const at = this.now()
    if (this.lastNudgeAt !== undefined && at - this.lastNudgeAt < this.cadence.nudgeThrottleMs) return
    this.lastNudgeAt = at
    if (this.busy()) return
    this.failures = 0
    // Scheduled rather than run inline: this is called from power and window events, and a check there
    // would run inside another subsystem's dispatch.
    console.log(`[auto-update] checking early — ${reason}`)
    this.scheduleCheck(1_000)
    this.opts.publish({ ...this.state })
  }

  /** Install a downloaded update now, because the user asked. */
  installNow(): void {
    if (this.stopped || this.installing) return
    if (this.state.phase !== 'ready') return
    void this.install()
  }

  /** "Later": keep the update, push the automatic restart out, and stop asking. */
  defer(): void {
    if (this.stopped || this.state.phase !== 'ready' || this.installing) return
    this.armAutoInstall(this.cadence.deferMs)
    const target = this.state.targetVersion ? ` ${this.state.targetVersion}` : ''
    this.update('ready', `Nexus${target} will install the next time you quit Nexus.`, { deferred: true })
  }

  private downloaded(version: string | undefined): void {
    if (this.stopped || this.installing) return
    this.failures = 0
    this.clearCheckTimer()
    const target = version ?? this.state.targetVersion
    this.update(
      'ready',
      `Nexus${target ? ` ${target}` : ''} is ready. Restart to install it, or let it install when you quit.`,
      { targetVersion: target, percent: 100, deferred: false }
    )
    try {
      this.opts.notifyReady?.(this.getStatus())
    } catch {
      // A notification that cannot be shown must not cost the update.
    }
    this.armAutoInstall(this.cadence.autoInstallDelayMs)
  }

  private async install(): Promise<void> {
    if (this.stopped || this.installing) return
    this.installing = true
    this.clearInstallTimer()
    this.clearCheckTimer()
    this.update('installing', 'Nexus is restarting to install an update. Unsaved input may be lost.')
    try {
      try {
        this.opts.notifyRestart()
      } catch {
        /* Notification support must not prevent updates. */
      }
      await this.opts.prepareInstall()
      if (this.stopped) return
      this.opts.engine.quitAndInstall(false, true)
    } catch {
      this.fail()
    }
  }

  stop(): void {
    this.stopped = true
    this.clearCheckTimer()
    this.clearInstallTimer()
    for (const [event, listener] of this.handlers) this.opts.engine.removeListener(event, listener)
    this.handlers.length = 0
  }
}
