export interface ToastData {
  id: string
  tabId: string
  tabTitle: string
  model: string
  status: 'done' | 'waiting-input'
  snippet?: string
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
