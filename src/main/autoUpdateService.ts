import type { UpdateStatus } from '../shared/updateStatus'

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

interface Options {
  engine: UpdateEngine
  version: string
  publish: (state: UpdateStatus) => void
  prepareInstall: () => Promise<void>
  installFailed: () => void
  notifyRestart: () => void
}

/** One service per main process. Provider pages cannot call the updater. */
export class AutoUpdateService {
  private state: UpdateStatus
  private checking = false
  private installing = false
  private stopped = false
  private startupTimer: ReturnType<typeof setTimeout> | undefined
  private interval: ReturnType<typeof setInterval> | undefined
  private readonly handlers: Array<[string, (...args: any[]) => void]> = []

  constructor(private readonly opts: Options) {
    this.state = { phase: 'idle', currentVersion: opts.version, message: 'Automatic updates enabled.' }
    opts.engine.autoDownload = true
    opts.engine.autoInstallOnAppQuit = false
    opts.engine.allowPrerelease = false
    opts.engine.allowDowngrade = false
    this.listen('checking-for-update', () => this.update('checking', 'Checking for updates.'))
    this.listen('update-available', (info: { version?: string }) => {
      this.update('downloading', 'Downloading an update.', { targetVersion: info?.version })
    })
    this.listen('download-progress', (progress: { percent?: number }) => {
      const p = Number(progress?.percent)
      this.update('downloading', 'Downloading an update.', { percent: Number.isFinite(p) ? Math.max(0, Math.min(100, p)) : undefined })
    })
    this.listen('update-not-available', () => this.update('up-to-date', 'Nexus is up to date.'))
    this.listen('error', () => this.fail())
    this.listen('update-downloaded', () => { void this.install() })
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

  private fail(): void {
    if (this.stopped) return
    if (this.installing) this.opts.installFailed()
    this.installing = false
    this.update('error', 'Update failed. Nexus will retry later.')
  }

  getStatus(): UpdateStatus { return { ...this.state } }

  start(): void {
    if (this.stopped || this.startupTimer || this.interval) return
    this.startupTimer = setTimeout(() => { this.startupTimer = undefined; void this.check() }, 30_000)
    this.interval = setInterval(() => { void this.check() }, 6 * 60 * 60 * 1000)
  }

  async check(): Promise<void> {
    if (this.stopped || this.checking || this.installing || this.state.phase === 'downloading') return
    this.checking = true
    this.update('checking', 'Checking for updates.')
    try { await this.opts.engine.checkForUpdates() } catch { this.fail() } finally { this.checking = false }
  }

  private async install(): Promise<void> {
    if (this.stopped || this.installing) return
    this.installing = true
    this.update('installing', 'Nexus is restarting to install an update. Unsaved input may be lost.')
    try {
      try { this.opts.notifyRestart() } catch { /* Notification support must not prevent updates. */ }
      await this.opts.prepareInstall()
      if (this.stopped) return
      this.opts.engine.quitAndInstall(false, true)
    } catch { this.fail() }
  }

  stop(): void {
    this.stopped = true
    if (this.startupTimer) clearTimeout(this.startupTimer)
    if (this.interval) clearInterval(this.interval)
    for (const [event, listener] of this.handlers) this.opts.engine.removeListener(event, listener)
    this.handlers.length = 0
  }
}
