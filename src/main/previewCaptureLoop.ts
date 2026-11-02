export interface PreviewCaptureOptions<T> {
  capture(session: T): Promise<string | null>
  publish(frame: string): void
  canCapture(): boolean
  intervalMs?: number
}

// At most one native capture, including across stop/start. A timeout must not
// release the guard: capturePage cannot be cancelled and may still be running.
export class PreviewCaptureLoop<T> {
  private session: T | null = null
  private generation = 0
  private timer: ReturnType<typeof setTimeout> | null = null
  private busy = false
  private pending = false
  private lastStarted = -Infinity
  private started = 0
  private published = 0
  private lastFrame: string | null = null
  private readonly interval: number

  constructor(private readonly options: PreviewCaptureOptions<T>) {
    this.interval = Math.max(250, options.intervalMs ?? 1000)
  }

  getStatus(): { active: boolean; inFlight: boolean; capturesStarted: number; publishedFrames: number } {
    return { active: this.session !== null, inFlight: this.busy,
      capturesStarted: this.started, publishedFrames: this.published }
  }

  start(session: T): void {
    this.stop()
    this.session = session
    this.request()
  }

  stop(): void {
    this.generation++
    this.session = null
    this.pending = false
    this.lastFrame = null
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }

  request(): void {
    if (this.session === null) return
    this.pending = true
    if (this.busy) return
    this.schedule(Math.max(0, this.interval - (Date.now() - this.lastStarted)))
  }

  private schedule(delay: number): void {
    if (this.session === null || this.timer) return
    this.timer = setTimeout(() => {
      this.timer = null
      void this.run()
    }, delay)
  }

  private async run(): Promise<void> {
    if (this.busy || this.session === null) return
    if (!this.options.canCapture()) {
      this.schedule(this.interval)
      return
    }
    const session = this.session
    const generation = this.generation
    this.busy = true
    this.pending = false
    this.lastStarted = Date.now()
    this.started++
    try {
      const frame = await this.options.capture(session)
      if (generation === this.generation && this.session === session &&
          this.options.canCapture() && frame && frame !== this.lastFrame) {
        this.options.publish(frame)
        this.lastFrame = frame
        this.published++
      }
    } catch {
      // Navigation/destruction failures are retried, never unhandled rejections.
    } finally {
      this.busy = false
      if (this.session !== null) {
        this.schedule(this.pending
          ? Math.max(0, this.interval - (Date.now() - this.lastStarted))
          : this.interval)
      }
    }
  }
}
