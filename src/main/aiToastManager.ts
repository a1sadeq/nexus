export interface ToastData {
  id: string
  tabId: string
  tabTitle: string
  model: string
  status: 'done' | 'waiting-input'
  snippet?: string
  /** How long the turn took, when measured. Absent means unknown, not zero. */
  durationMs?: number
}

export interface ToastViewTarget {
  isDestroyed(): boolean
  loadHtml(html: string): void
  setVisible(visible: boolean): void
  setBounds(bounds: { x: number; y: number; width: number; height: number }): void
  startExitAnimation(): void
}

export class AiToastManager {
  private dismissTimer: NodeJS.Timeout | null = null
  private exitTimer: NodeJS.Timeout | null = null
  private currentEpoch = 0
  private currentData: ToastData | null = null
  private isVisible = false
  /** When the current toast was shown, and how much of its life it had left when it was suspended. */
  private shownAt = 0
  private remainingMs: number | null = null
  private suspended = false

  constructor(
    private readonly getView: () => ToastViewTarget | null | undefined,
    private readonly getBounds?: () => { x: number; y: number; width: number; height: number },
    private readonly buildHtml?: (data: ToastData) => string,
    private readonly autoDismissMs: number = 6800,
    private readonly exitAnimationMs: number = 200
  ) {}

  public getIsVisible(): boolean {
    return this.isVisible
  }

  public getCurrentData(): ToastData | null {
    return this.currentData
  }

  public getCurrentEpoch(): number {
    return this.currentEpoch
  }

  public isExitTimerActive(): boolean {
    return this.exitTimer !== null
  }

  public show(data: ToastData): void {
    const view = this.getView()
    if (!view || view.isDestroyed()) return

    // Monotonically bump toast epoch so any pending exit timers from previous toasts are invalidated
    this.currentEpoch++

    // Cancel pending dismiss or exit timers immediately
    if (this.dismissTimer) {
      clearTimeout(this.dismissTimer)
      this.dismissTimer = null
    }
    if (this.exitTimer) {
      clearTimeout(this.exitTimer)
      this.exitTimer = null
    }

    this.currentData = data
    this.isVisible = true
    this.suspended = false
    this.remainingMs = null
    this.shownAt = Date.now()

    if (this.buildHtml) {
      view.loadHtml(this.buildHtml(data))
    }

    if (this.getBounds) {
      view.setBounds(this.getBounds())
    }
    view.setVisible(true)

    // Schedule exit timer
    this.dismissTimer = setTimeout(() => {
      this.dismiss(false)
    }, this.autoDismissMs)
  }

  public isSuspended(): boolean {
    return this.suspended
  }

  /**
   * Hide the toast without ending it — an overlay is up, or the window lost the surface.
   *
   * The toast used to be *dismissed* whenever a panel opened (`dismissInAppToast()` in the overlay
   * handler), so "a notification appeared" and "I pressed Ctrl+L" meant the notification was gone. A
   * native view also cannot sit above a DOM overlay, so hiding is necessary; losing the notification is
   * not. The remaining lifetime is banked here and re-armed by `resume()`.
   */
  public suspend(): void {
    if (!this.currentData || this.suspended) return
    if (this.dismissTimer) {
      clearTimeout(this.dismissTimer)
      this.dismissTimer = null
    }
    if (this.exitTimer) {
      clearTimeout(this.exitTimer)
      this.exitTimer = null
    }
    const elapsed = this.shownAt > 0 ? Date.now() - this.shownAt : 0
    this.remainingMs = Math.max(1200, this.autoDismissMs - elapsed)
    this.suspended = true
    this.isVisible = false
    const view = this.getView()
    if (view && !view.isDestroyed()) {
      try {
        view.setVisible(false)
      } catch {
        /* the window may be going away with it */
      }
    }
  }

  /** Bring a suspended toast back, with the time it had left rather than a fresh countdown. */
  public resume(): void {
    if (!this.suspended || !this.currentData) return
    const view = this.getView()
    if (!view || view.isDestroyed()) {
      this.suspended = false
      this.currentData = null
      this.isVisible = false
      return
    }
    this.suspended = false
    this.isVisible = true
    this.shownAt = Date.now()
    if (this.getBounds) {
      try {
        view.setBounds(this.getBounds())
      } catch {
        /* geometry is re-sent by the renderer on the next resize */
      }
    }
    try {
      view.setVisible(true)
    } catch {
      /* nothing to show on */
    }
    const left = this.remainingMs ?? this.autoDismissMs
    this.remainingMs = null
    if (this.dismissTimer) clearTimeout(this.dismissTimer)
    this.dismissTimer = setTimeout(() => {
      this.dismiss(false)
    }, left)
  }

  public dismiss(immediate = false): void {
    if (this.dismissTimer) {
      clearTimeout(this.dismissTimer)
      this.dismissTimer = null
    }
    if (this.exitTimer) {
      clearTimeout(this.exitTimer)
      this.exitTimer = null
    }

    const view = this.getView()
    this.suspended = false
    this.remainingMs = null

    if (immediate) {
      this.currentData = null
      this.isVisible = false
      if (view && !view.isDestroyed()) {
        try {
          view.setVisible(false)
          view.setBounds({ x: 0, y: 0, width: 0, height: 0 })
        } catch {}
      }
      return
    }

    // A suspended toast is off screen: there is nothing to animate out, and running the exit anyway
    // would put it back on the window for exitAnimationMs before hiding it again. End it quietly.
    if (this.isVisible === false) {
      this.currentData = null
      if (this.exitTimer) {
        clearTimeout(this.exitTimer)
        this.exitTimer = null
      }
      return
    }

    // Trigger visual exit animation
    if (view && !view.isDestroyed()) {
      try {
        view.startExitAnimation()
      } catch {}
    }

    const dismissEpoch = this.currentEpoch
    this.exitTimer = setTimeout(() => {
      this.exitTimer = null
      // Check if a newer toast has replaced this one during the exit animation window!
      if (this.currentEpoch !== dismissEpoch) {
        return
      }
      this.currentData = null
      this.isVisible = false
      const targetView = this.getView()
      if (targetView && !targetView.isDestroyed()) {
        try {
          targetView.setVisible(false)
          targetView.setBounds({ x: 0, y: 0, width: 0, height: 0 })
        } catch {}
      }
    }, this.exitAnimationMs)
  }
}
