import { randomUUID } from 'node:crypto'

/**
 * Unwired in-memory coordination for trusted main-process adapters only.
 * This does not cancel a process, sandbox an agent, authenticate a caller,
 * enforce permissions, or undo any effects. Adapters must cooperate and
 * independently enforce the real side-effect boundary.
 */
export type ActionGateState = 'ready' | 'running' | 'paused' | 'uncertain'
export interface ActionGateSnapshot {
  state: ActionGateState
  running: boolean
  stopAllLatched: boolean
}
export interface ActionTicket {
  readonly tabId: string
  readonly actionId: string
  readonly signal: AbortSignal
}
interface Action {
  id: string
  controller: AbortController
  dispatched: boolean
}
interface Tab {
  paused: boolean
  uncertain: boolean
  action: Action | null
}

const MAX_TABS = 256

export class AgentActionStopGate {
  private readonly tabs = new Map<string, Tab>()
  private allStopped = false
  private stopAllDispatchDepth = 0

  private validateId(tabId: string): void {
    if (typeof tabId !== 'string' || !tabId.trim() || tabId.length > 1024)
      throw new Error('Invalid tab ID')
  }

  private requireTab(tabId: string): Tab {
    this.validateId(tabId)
    const tab = this.tabs.get(tabId)
    if (!tab) throw new Error('Unknown tab')
    return tab
  }

  /** Trusted owner explicitly creates entries; stop-all blocks new entries too. */
  register(tabId: string): void {
    this.validateId(tabId)
    if (this.allStopped) throw new Error('Stop All is active')
    if (this.tabs.has(tabId)) throw new Error('Tab already registered')
    if (this.tabs.size >= MAX_TABS) throw new Error('Tab limit reached')
    this.tabs.set(tabId, { paused: false, uncertain: false, action: null })
  }

  snapshot(tabId: string): ActionGateSnapshot {
    const tab = this.requireTab(tabId)
    const state = tab.uncertain
      ? 'uncertain'
      : tab.paused
        ? 'paused'
        : tab.action
          ? 'running'
          : 'ready'
    return { state, running: tab.action !== null, stopAllLatched: this.allStopped }
  }

  begin(tabId: string): ActionTicket {
    const tab = this.requireTab(tabId)
    if (this.allStopped || tab.paused || tab.uncertain || tab.action)
      throw new Error('Action blocked')
    const action: Action = {
      id: randomUUID(),
      controller: new AbortController(),
      dispatched: false
    }
    tab.action = action
    return { tabId, actionId: action.id, signal: action.controller.signal }
  }

  private current(ticket: ActionTicket): { tab: Tab; action: Action } {
    if (!ticket || typeof ticket !== 'object') throw new Error('Invalid action ticket')
    const tab = this.requireTab(ticket.tabId)
    const action = tab.action
    if (!action || action.id !== ticket.actionId || action.controller.signal !== ticket.signal)
      throw new Error('Stale action ticket')
    return { tab, action }
  }

  /** Check immediately before an operation. Not atomic with asynchronous effects. */
  assertActive(ticket: ActionTicket): void {
    const { tab, action } = this.current(ticket)
    if (this.allStopped || tab.paused || tab.uncertain || action.controller.signal.aborted)
      throw new Error('Action stopped')
  }

  /** Mark immediately BEFORE crossing any external side-effect boundary. */
  markSideEffectStarting(ticket: ActionTicket): void {
    this.assertActive(ticket)
    const { action } = this.current(ticket)
    action.dispatched = true
  }

  /**
   * Settle only after the adapter's actual action has stopped. A failed or
   * stopped dispatched action stays uncertain; never infer success from abort.
   */
  finish(ticket: ActionTicket, outcome: 'completed' | 'failed'): ActionGateSnapshot {
    if (outcome !== 'completed' && outcome !== 'failed') throw new Error('Invalid outcome')
    const { tab, action } = this.current(ticket)
    if (action.dispatched && (outcome === 'failed' || tab.paused || this.allStopped)) {
      tab.uncertain = true
      tab.paused = true
    }
    if (outcome === 'failed') tab.paused = true
    tab.action = null
    return this.snapshot(ticket.tabId)
  }

  /** Pause first, then signal; a dispatched action becomes uncertain immediately. */
  stop(tabId: string): ActionGateSnapshot {
    const tab = this.requireTab(tabId)
    tab.paused = true
    if (tab.action?.dispatched) tab.uncertain = true
    tab.action?.controller.abort()
    return this.snapshot(tabId)
  }

  /** Block every tab and future registrations before any synchronous abort handler runs. */
  stopAll(): void {
    this.allStopped = true
    const controllers: AbortController[] = []
    for (const tab of this.tabs.values()) {
      tab.paused = true
      if (tab.action) {
        if (tab.action.dispatched) tab.uncertain = true
        controllers.push(tab.action.controller)
      }
    }
    this.stopAllDispatchDepth++
    try {
      for (const controller of controllers) controller.abort()
    } finally {
      this.stopAllDispatchDepth--
    }
  }

  /** Only after independent reconciliation; this does not resume or resend. */
  acknowledgeUncertainty(tabId: string): void {
    const tab = this.requireTab(tabId)
    if (tab.action || !tab.uncertain) throw new Error('Cannot acknowledge uncertainty')
    tab.uncertain = false
    tab.paused = true
  }

  /** Unlatching Stop All leaves every tab paused. */
  releaseStopAll(): void {
    if (this.stopAllDispatchDepth) throw new Error('Stop All is still signaling')
    this.allStopped = false
  }

  /** Resume requires a fresh, separately verified identity and grant in the owner. */
  resume(tabId: string): void {
    const tab = this.requireTab(tabId)
    if (this.allStopped || tab.action || tab.uncertain || !tab.paused)
      throw new Error('Cannot resume')
    tab.paused = false
  }

  /** Teardown cannot erase a running or unresolved action. */
  unregister(tabId: string): void {
    const tab = this.requireTab(tabId)
    if (tab.action || tab.uncertain) throw new Error('Cannot unregister unresolved action')
    this.tabs.delete(tabId)
  }
}
