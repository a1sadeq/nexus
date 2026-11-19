import type { AgentHistory } from './agentHistory'

/**
 * Optional main-process scheduler; no IPC or UI. The owner must surface failures
 * and stop this before closing the store. Timer-based retention cannot promise
 * secure erasure, or deletion while the application is not running.
 */
export class AgentHistoryRetention {
  private timer: ReturnType<typeof setTimeout> | null = null
  private running = false
  private failure = false

  constructor(
    private readonly history: AgentHistory,
    private readonly onFailure: () => void,
    private readonly intervalMs = 60 * 60 * 1000
  ) {
    if (
      !history ||
      typeof history.prune !== 'function' ||
      typeof onFailure !== 'function' ||
      !Number.isSafeInteger(intervalMs) ||
      intervalMs < 60000 ||
      intervalMs > 86400000
    )
      throw new Error('Invalid retention scheduler')
  }

  start(): void {
    if (this.running) return
    this.running = true
    this.schedule()
  }

  private schedule(): void {
    if (!this.running || this.timer !== null) return
    this.timer = setTimeout(() => {
      this.timer = null
      if (!this.running) return
      try {
        this.history.prune()
        this.failure = false
      } catch {
        this.failure = true
        try {
          this.onFailure()
        } catch {
          /* the owner remains responsible for reporting */
        }
      }
      this.schedule()
    }, this.intervalMs)
    this.timer.unref?.()
  }

  /** Most recent attempted prune failed; no error or content is exposed. */
  hasFailure(): boolean {
    return this.failure
  }

  stop(): void {
    this.running = false
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }
}
