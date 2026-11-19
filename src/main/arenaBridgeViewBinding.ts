import type {
  AgentBridgeCoordinator,
  CoordinatedAction,
  CoordinatedSnapshot
} from './agentBridgeCoordinator'
import type { BridgeTarget } from './agentBridgeSession'
import type { ArenaViewLease } from './arenaViewLease'

/**
 * Unwired main-process bridge adapter. The owner must keep the coordinator and
 * its action handles private. This doesn't authenticate the account, chat,
 * project, grant or page; establish those independently. It performs no send.
 * Registry-only invalidation/replacement is detected when an operation checks
 * the lease; the trusted owner must actively invalidate at teardown/reset start.
 */
export class ArenaBridgeViewBinding {
  private closed = false
  private stopFailed = false
  private readonly actions = new WeakSet<CoordinatedAction>()
  private readonly onAbort = (): void => {
    if (this.closed) return
    this.closed = true
    // Invalidate dependent review bookkeeping before cancellation callbacks.
    try {
      this.beforeStop?.()
    } catch {
      this.stopFailed = true
    }
    // A failure to stop cannot turn this binding active again.
    try {
      this.coordinator.stop(this.lease.tabId)
    } catch {
      this.stopFailed = true
    }
  }

  constructor(
    private readonly coordinator: AgentBridgeCoordinator,
    private readonly lease: ArenaViewLease,
    private readonly beforeStop?: () => void
  ) {
    lease.signal.addEventListener('abort', this.onAbort, { once: true })
    try {
      this.check()
    } catch {
      this.onAbort()
      lease.signal.removeEventListener('abort', this.onAbort)
      throw new Error('View binding unavailable')
    }
  }

  /** Failure is diagnostic only; neither value proves the action stopped. */
  status(): { closed: boolean; stopFailed: boolean } {
    return { closed: this.closed, stopFailed: this.stopFailed }
  }

  private check(): void {
    if (this.closed || this.lease.signal.aborted) {
      this.onAbort()
      throw new Error('View binding invalid')
    }
    try {
      this.lease.assertCurrent()
    } catch {
      this.onAbort()
      throw new Error('View binding invalid')
    }
    if (this.closed || this.lease.signal.aborted) throw new Error('View binding invalid')
  }

  private target(observed: BridgeTarget): BridgeTarget {
    const keys: ReadonlyArray<keyof BridgeTarget> = [
      'tabId',
      'providerId',
      'conversationId',
      'navigationEpoch',
      'agentSessionId',
      'projectId',
      'worktreeId'
    ]
    const copy = {} as BridgeTarget
    try {
      for (const key of keys) {
        const descriptor = Object.getOwnPropertyDescriptor(observed, key)
        if (!descriptor || !('value' in descriptor) || typeof descriptor.value !== 'string')
          throw new Error('Invalid target')
        copy[key] = descriptor.value
      }
      if (copy.tabId !== this.lease.tabId) throw new Error('Target tab mismatch')
      // A proxy descriptor trap can invalidate the view during copying.
      this.check()
      return copy
    } catch {
      this.onAbort()
      throw new Error('View target invalid')
    }
  }

  begin(observed: BridgeTarget): CoordinatedAction {
    this.check()
    const cleanTarget = this.target(observed)
    const action = this.coordinator.begin(this.lease.tabId, cleanTarget)
    try {
      this.check()
    } catch {
      // The handle has not been returned and dispatch has not been marked, so
      // no adapter can have started this action. Clear the local reservation.
      try {
        this.coordinator.finishFailed(action)
      } catch {
        this.stopFailed = true
      }
      throw new Error('View binding invalid')
    }
    this.actions.add(action)
    return action
  }

  markSideEffectStarting(action: CoordinatedAction, observed: BridgeTarget): void {
    this.check()
    if (!action || !this.actions.has(action)) throw new Error('Action does not belong to binding')
    const cleanTarget = this.target(observed)
    this.coordinator.markSideEffectStarting(action, cleanTarget)
    this.check()
  }

  complete(action: CoordinatedAction, observed: BridgeTarget): CoordinatedSnapshot {
    this.check()
    if (!action || !this.actions.has(action)) throw new Error('Action does not belong to binding')
    const cleanTarget = this.target(observed)
    const result = this.coordinator.complete(action, cleanTarget)
    this.check()
    return result
  }

  /** Stop immediately at teardown initiation, before any awaited native close. */
  dispose(): void {
    this.onAbort()
    this.lease.signal.removeEventListener('abort', this.onAbort)
    this.lease.dispose()
  }
}
