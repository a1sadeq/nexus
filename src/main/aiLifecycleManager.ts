import {
  type AiLifecycleStatus,
  type TabAiLifecycleState,
  type AiLifecycleStatusUpdate,
  isGenuineCompletionTransition,
  shouldDeduplicateCompletion,
  ACTIVE_TAB_DONE_LINGER_MS
} from '../shared/aiLifecycle'

export interface AiLifecycleManagerCallbacks {
  sendToMainWindow: (channel: string, ...args: any[]) => void
  onAiStatusChanged?: (tabId: string, isIdle: boolean) => void
  showInAppToast?: (data: {
    id: string
    tabId: string
    tabTitle: string
    model: string
    status: 'done' | 'waiting-input'
    snippet?: string
  }) => void
  getActiveViewId: () => string | null | undefined
  getTabTitle?: (tabId: string) => string
  getModelKey?: (tabId: string) => string
}

export class AiLifecycleManager {
  public readonly activeLifecycles = new Map<string, TabAiLifecycleState>()
  public readonly lifecycleTimers = new Map<string, NodeJS.Timeout>()
  public readonly viewGenerations = new Map<string, number>()
  public readonly lastCompletions = new Map<string, { status: string; revision: number; time: number }>()

  constructor(private callbacks?: Partial<AiLifecycleManagerCallbacks>) {}

  public setCallbacks(callbacks: Partial<AiLifecycleManagerCallbacks>): void {
    this.callbacks = { ...this.callbacks, ...callbacks }
  }

  public getTabViewGeneration(tabId: string): number {
    return this.viewGenerations.get(tabId) ?? 1
  }

  public initTabViewGeneration(tabId: string, initialGen = 1): number {
    this.viewGenerations.set(tabId, initialGen)
    return initialGen
  }

  public bumpTabViewGeneration(tabId: string): number {
    const current = this.viewGenerations.get(tabId) ?? 1
    const next = current + 1
    this.viewGenerations.set(tabId, next)
    return next
  }

  public getTabAiStatus(tabId: string): AiLifecycleStatus {
    return this.activeLifecycles.get(tabId)?.status ?? 'unknown'
  }

  public getTabAiLifecycle(tabId: string): TabAiLifecycleState | undefined {
    return this.activeLifecycles.get(tabId)
  }

  public clearTab(tabId: string): void {
    const timer = this.lifecycleTimers.get(tabId)
    if (timer) {
      clearTimeout(timer)
      this.lifecycleTimers.delete(tabId)
    }
    this.activeLifecycles.delete(tabId)
    this.viewGenerations.delete(tabId)
    this.lastCompletions.delete(tabId)
  }

  public setTabAiLifecycle(
    tabId: string,
    nextStatus: AiLifecycleStatus,
    options?: {
      lastSnippet?: string
      error?: string
      viewGeneration?: number
      skipTimer?: boolean
    }
  ): boolean {
    const currentViewGen = this.getTabViewGeneration(tabId)
    if (options?.viewGeneration !== undefined && options.viewGeneration < currentViewGen) {
      // Drop stale updates from an older view/navigation epoch
      return false
    }

    const existing = this.activeLifecycles.get(tabId)
    const viewGen = options?.viewGeneration ?? existing?.viewGeneration ?? currentViewGen
    const nextRev = (existing?.revision ?? 0) + 1
    const prevStatus = existing?.status ?? 'unknown'
    const now = Date.now()

    // Clear existing linger timer if any
    const existingTimer = this.lifecycleTimers.get(tabId)
    if (existingTimer) {
      clearTimeout(existingTimer)
      this.lifecycleTimers.delete(tabId)
    }

    const activeViewId = this.callbacks?.getActiveViewId?.()
    const isActive = tabId === activeViewId
    const isBackground = !isActive

    let enteredIdleAt = existing?.enteredIdleAt
    if (nextStatus === 'idle') {
      if (!enteredIdleAt) enteredIdleAt = now
    } else {
      enteredIdleAt = undefined
    }

    const nextState: TabAiLifecycleState = {
      tabId,
      status: nextStatus,
      revision: nextRev,
      viewGeneration: viewGen,
      lastSnippet: options?.lastSnippet !== undefined ? options.lastSnippet : existing?.lastSnippet,
      error: options?.error !== undefined ? options.error : existing?.error,
      updatedAt: now,
      enteredIdleAt,
      isBackgroundCompletion: nextStatus === 'done' ? isBackground : false
    }
    this.activeLifecycles.set(tabId, nextState)

    // Handle linger timers for 'done'
    if (nextStatus === 'done' && !options?.skipTimer) {
      if (isActive) {
        const timer = setTimeout(() => {
          const cur = this.activeLifecycles.get(tabId)
          const latestGen = this.getTabViewGeneration(tabId)
          if (
            cur &&
            cur.revision === nextRev &&
            cur.viewGeneration === viewGen &&
            latestGen === viewGen &&
            cur.status === 'done'
          ) {
            this.setTabAiLifecycle(tabId, 'idle', { viewGeneration: viewGen })
          }
        }, ACTIVE_TAB_DONE_LINGER_MS)
        this.lifecycleTimers.set(tabId, timer)
      }
    }

    // Inform TabDiscardManager
    this.callbacks?.onAiStatusChanged?.(tabId, nextStatus === 'idle')

    // Publish to mainWindow
    const updatePayload: AiLifecycleStatusUpdate = {
      tabId,
      status: nextStatus,
      revision: nextRev,
      viewGeneration: viewGen,
      lastSnippet: nextState.lastSnippet,
      error: nextState.error,
      timestamp: now
    }
    this.callbacks?.sendToMainWindow?.('ai-lifecycle-status', updatePayload)

    // Genuine completion check
    const isGenuineCompletion = isGenuineCompletionTransition(prevStatus, nextStatus)

    if (isGenuineCompletion) {
      this.triggerCompletionNotification(tabId, nextStatus, nextState.lastSnippet)
      this.callbacks?.sendToMainWindow?.('ai-live-status', tabId, false, nextState.lastSnippet || '')
    } else if (nextStatus === 'working' && prevStatus !== 'working') {
      this.callbacks?.sendToMainWindow?.('ai-live-status', tabId, true, '')
    }

    return true
  }

  private triggerCompletionNotification(
    tabId: string,
    status: 'done' | 'waiting-input',
    snippet?: string
  ): void {
    const now = Date.now()
    const prev = this.lastCompletions.get(tabId)
    const currentRev = this.activeLifecycles.get(tabId)?.revision ?? 0
    if (shouldDeduplicateCompletion(prev, status, currentRev, now)) return
    this.lastCompletions.set(tabId, { status, revision: currentRev, time: now })

    const tabTitle = this.callbacks?.getTabTitle?.(tabId) || 'AI Session'
    const modelKey = this.callbacks?.getModelKey?.(tabId) || 'gemini'
    this.callbacks?.showInAppToast?.({
      id: `${tabId}-${now}-${Math.random().toString(36).slice(2, 6)}`,
      tabId,
      tabTitle,
      model: modelKey,
      status,
      snippet
    })
  }
}
