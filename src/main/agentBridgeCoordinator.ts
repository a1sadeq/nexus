import { randomUUID } from 'node:crypto'
import {
  AgentBridgeSessions,
  type BridgeLease,
  type BridgeSnapshot,
  type BridgeTarget
} from './agentBridgeSession'
import {
  AgentActionStopGate,
  type ActionGateSnapshot,
  type ActionTicket
} from './agentActionStopGate'

import {
  watchArenaConsultation,
  type ProviderCondition,
  type WatchResult
} from './arenaConsultationWatch'
import type { ReplySnapshot } from './arenaReplyCandidate'

/**
 * Unwired trusted-owner coordination only. This is not a security boundary,
 * an IPC interface, provider authentication, sandbox, process cancellation,
 * persisted consent, or a proof that a side effect succeeded. Every adapter
 * must use and enforce the real boundary independently.
 */
export interface CoordinatedAction {
  readonly tabId: string
  readonly actionId: string
  readonly signal: AbortSignal
}
export interface CoordinatedSnapshot {
  session: BridgeSnapshot
  gate: ActionGateSnapshot
}
interface Running {
  id: string
  ticket: ActionTicket
  lease: BridgeLease
  dispatched: boolean
  watchOpened: boolean
}
interface Entry {
  sessionId: string
  running: Running | null
}

const targetKeys: ReadonlyArray<keyof BridgeTarget> = [
  'tabId',
  'providerId',
  'conversationId',
  'navigationEpoch',
  'agentSessionId',
  'projectId',
  'worktreeId'
]

// Never repeatedly evaluate caller-provided getters across state transitions.
// Even reflection on a Proxy can run code; each method performs all its
// state/lease checks only AFTER this copy has completed.
function copyPlainTarget(value: BridgeTarget): BridgeTarget {
  if (!value || typeof value !== 'object') throw new Error('Invalid target')
  const result = {} as BridgeTarget
  try {
    for (const key of targetKeys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (
        !descriptor ||
        !('value' in descriptor) ||
        typeof descriptor.value !== 'string' ||
        !descriptor.value.trim() ||
        descriptor.value.length > 1024
      )
        throw new Error('Invalid target')
      result[key] = descriptor.value
    }
  } catch {
    throw new Error('Invalid target')
  }
  return result
}

export class AgentBridgeCoordinator {
  private readonly sessions = new AgentBridgeSessions()
  private readonly gate = new AgentActionStopGate()
  private readonly entries = new Map<string, Entry>()
  private stoppedAll = false
  private signalingAll = false
  private readonly signalingTabs = new Map<string, number>()
  private readonly handles = new WeakMap<CoordinatedAction, string>()

  private entry(tabId: string): Entry {
    const entry = this.entries.get(tabId)
    if (!entry) throw new Error('Unknown tab')
    return entry
  }

  private action(handle: CoordinatedAction): { entry: Entry; running: Running } {
    if (!handle || typeof handle !== 'object') throw new Error('Invalid action')
    const tabId = this.handles.get(handle)
    if (tabId === undefined) throw new Error('Stale action')
    const entry = this.entry(tabId)
    const running = entry.running
    if (!running || running.id !== handle.actionId || running.ticket.signal !== handle.signal)
      throw new Error('Stale action')
    return { entry, running }
  }

  /** The supplied target must come from independently verified trusted code. */
  register(target: BridgeTarget): CoordinatedSnapshot {
    const cleanTarget = copyPlainTarget(target)
    if (this.stoppedAll) throw new Error('Stop All is active')
    const tabId = cleanTarget.tabId
    if (this.entries.has(tabId)) throw new Error('Tab already registered')
    this.gate.register(tabId)
    try {
      const session = this.sessions.create(cleanTarget)
      this.entries.set(tabId, { sessionId: session.sessionId, running: null })
      return this.snapshot(tabId)
    } catch {
      this.gate.unregister(tabId)
      throw new Error('Invalid target')
    }
  }

  snapshot(tabId: string): CoordinatedSnapshot {
    const entry = this.entry(tabId)
    return { session: this.sessions.snapshot(entry.sessionId), gate: this.gate.snapshot(tabId) }
  }

  /** Call only after separate user consent and independent identity validation. */
  grant(tabId: string, observed: BridgeTarget): CoordinatedSnapshot {
    const cleanTarget = copyPlainTarget(observed)
    const entry = this.entry(tabId)
    const gate = this.gate.snapshot(tabId)
    if (this.stoppedAll || gate.state !== 'ready' || gate.stopAllLatched)
      throw new Error('Grant blocked')
    this.sessions.grant(entry.sessionId, cleanTarget)
    return this.snapshot(tabId)
  }

  begin(tabId: string, observed: BridgeTarget): CoordinatedAction {
    const cleanTarget = copyPlainTarget(observed)
    const entry = this.entry(tabId)
    if (this.stoppedAll || entry.running) throw new Error('Action blocked')
    const ticket = this.gate.begin(tabId)
    try {
      const lease = this.sessions.begin(entry.sessionId, cleanTarget)
      const running: Running = {
        id: randomUUID(),
        ticket,
        lease,
        dispatched: false,
        watchOpened: false
      }
      entry.running = running
      const handle = Object.freeze({ tabId, actionId: running.id, signal: ticket.signal })
      this.handles.set(handle, tabId)
      return handle
    } catch {
      // Any disagreement fails closed; an identity mismatch can pause sessions.
      this.gate.stop(tabId)
      this.gate.finish(ticket, 'failed')
      throw new Error('Action blocked by session')
    }
  }

  private checkedAction(
    handle: CoordinatedAction,
    observed: BridgeTarget
  ): {
    entry: Entry
    running: Running
    cleanTarget: BridgeTarget
  } {
    const { entry, running } = this.action(handle)
    try {
      const cleanTarget = copyPlainTarget(observed)
      if (entry.running !== running || this.stoppedAll) throw new Error('Action changed')
      this.gate.assertActive(running.ticket)
      this.sessions.assertLease(running.lease, cleanTarget)
      return { entry, running, cleanTarget }
    } catch {
      // A target proxy can reenter the owner; never stop a replacement action.
      if (entry.running === running) this.stop(handle.tabId)
      throw new Error('Action is not active')
    }
  }

  assertActive(handle: CoordinatedAction, observed: BridgeTarget): void {
    this.checkedAction(handle, observed)
  }

  /** Bookkeeping only; caller must independently enforce and perform the side effect. */
  markSideEffectStarting(handle: CoordinatedAction, observed: BridgeTarget): void {
    const { running, cleanTarget } = this.checkedAction(handle, observed)
    if (running.dispatched) throw new Error('Side effect already marked')
    try {
      // Mark the gate first: partial failure is treated conservatively as uncertain.
      this.gate.markSideEffectStarting(running.ticket)
      this.sessions.markDispatchStarting(running.lease, cleanTarget)
      running.dispatched = true
    } catch {
      this.stop(handle.tabId)
      throw new Error('Cannot mark dispatch')
    }
  }

  /** Read-only candidate watch; caller-supplied evidence/condition is not authenticated. */
  openWatch(
    handle: CoordinatedAction,
    observed: BridgeTarget,
    baseline: ReplySnapshot,
    expectedUserDigest: string,
    startMs: number,
    timeoutMs: number
  ): {
    observe: (
      snapshot: unknown,
      target: BridgeTarget,
      condition: ProviderCondition,
      nowMs: number
    ) => WatchResult
  } {
    const { entry, running, cleanTarget } = this.checkedAction(handle, observed)
    if (!running.dispatched || running.watchOpened) throw new Error('Watch unavailable')
    running.watchOpened = true
    let watch: ReturnType<typeof watchArenaConsultation>
    try {
      watch = watchArenaConsultation(
        this.sessions,
        running.lease,
        cleanTarget,
        baseline,
        expectedUserDigest,
        startMs,
        timeoutMs
      )
    } catch {
      if (entry.running === running) this.stop(handle.tabId)
      throw new Error('Watch initialization failed')
    }
    return {
      observe: (snapshot, target, condition, nowMs) => {
        const invalid: WatchResult = { state: 'paused', reason: 'lease-invalid' }
        if (entry.running !== running) return invalid
        try {
          const checked = this.checkedAction(handle, target)
          const result = watch.observe(snapshot, checked.cleanTarget, condition, nowMs)
          if (entry.running !== running) return invalid
          if (result.state === 'paused') this.stop(handle.tabId)
          return result
        } catch {
          if (entry.running === running) this.stop(handle.tabId)
          return invalid
        }
      }
    }
  }

  /** Completion is a trusted adapter assertion, not independent evidence. */
  complete(handle: CoordinatedAction, observed: BridgeTarget): CoordinatedSnapshot {
    const { entry, running, cleanTarget } = this.checkedAction(handle, observed)
    if (!running.dispatched) throw new Error('Dispatch not marked')
    try {
      this.sessions.resolve(running.lease, cleanTarget)
      this.gate.finish(running.ticket, 'completed')
      entry.running = null
      return this.snapshot(handle.tabId)
    } catch {
      this.stop(handle.tabId)
      throw new Error('Completion could not be established')
    }
  }

  /** Only call after actual adapter settlement; stopping is not settlement. */
  finishFailed(handle: CoordinatedAction): CoordinatedSnapshot {
    const { entry, running } = this.action(handle)
    this.stop(handle.tabId)
    // A synchronous abort listener may have already settled this action.
    if (entry.running !== running) throw new Error('Action already settled')
    this.gate.finish(running.ticket, 'failed')
    entry.running = null
    return this.snapshot(handle.tabId)
  }

  private signalStop(tabId: string): void {
    this.signalingTabs.set(tabId, (this.signalingTabs.get(tabId) ?? 0) + 1)
    try {
      this.gate.stop(tabId)
    } finally {
      const depth = (this.signalingTabs.get(tabId) ?? 1) - 1
      if (depth) this.signalingTabs.set(tabId, depth)
      else this.signalingTabs.delete(tabId)
    }
  }

  stop(tabId: string): CoordinatedSnapshot {
    const entry = this.entry(tabId)
    const phase = this.sessions.snapshot(entry.sessionId).phase
    if (phase !== 'awaiting-consent' && phase !== 'revoked') this.sessions.pause(entry.sessionId)
    this.signalStop(tabId)
    return this.snapshot(tabId)
  }

  /** Permanently revoke this in-memory session before signaling its action. */
  revoke(tabId: string): CoordinatedSnapshot {
    const entry = this.entry(tabId)
    this.sessions.revoke(entry.sessionId)
    this.signalStop(tabId)
    return this.snapshot(tabId)
  }

  stopAll(): void {
    this.stoppedAll = true
    if (this.signalingAll) return
    this.signalingAll = true
    try {
      // Pause all sessions before gate signals any abort listener.
      for (const entry of this.entries.values()) {
        const phase = this.sessions.snapshot(entry.sessionId).phase
        if (phase !== 'awaiting-consent' && phase !== 'revoked')
          this.sessions.pause(entry.sessionId)
      }
      this.gate.stopAll()
    } finally {
      this.signalingAll = false
    }
  }

  releaseStopAll(): void {
    if (this.signalingAll) throw new Error('Stop All is still signaling')
    this.gate.releaseStopAll()
    this.stoppedAll = false
  }

  /** Caller must independently reconcile actual outcome; this never resumes. */
  acknowledgeUncertainty(tabId: string, observed: BridgeTarget): CoordinatedSnapshot {
    const cleanTarget = copyPlainTarget(observed)
    const entry = this.entry(tabId)
    if (entry.running) throw new Error('Action has not settled')
    const session = this.sessions.snapshot(entry.sessionId)
    const gate = this.gate.snapshot(tabId)
    if (session.phase !== 'uncertain' && gate.state !== 'uncertain')
      throw new Error('No uncertainty')
    if (session.phase === 'uncertain')
      this.sessions.acknowledgeUncertainty(entry.sessionId, cleanTarget)
    // Session may already be paused on a partial mark; independently validate
    // the target before clearing the gate in that case by using resume+pause.
    else if (session.phase === 'paused') {
      this.sessions.resume(entry.sessionId, cleanTarget)
      this.sessions.pause(entry.sessionId)
    } else throw new Error('Session cannot reconcile')
    if (gate.state === 'uncertain') this.gate.acknowledgeUncertainty(tabId)
    return this.snapshot(tabId)
  }

  /** Caller must freshly verify the original target and grant before invoking. */
  resume(tabId: string, observed: BridgeTarget): CoordinatedSnapshot {
    const cleanTarget = copyPlainTarget(observed)
    const entry = this.entry(tabId)
    if (this.stoppedAll || this.signalingAll || this.signalingTabs.has(tabId) || entry.running)
      throw new Error('Resume blocked')
    const session = this.sessions.snapshot(entry.sessionId)
    const gate = this.gate.snapshot(tabId)
    if (gate.state !== 'paused' || gate.running || gate.stopAllLatched)
      throw new Error('Resume blocked')
    if (session.phase === 'awaiting-consent') {
      this.gate.resume(tabId)
      return this.snapshot(tabId)
    }
    this.sessions.resume(entry.sessionId, cleanTarget)
    try {
      this.gate.resume(tabId)
    } catch {
      this.sessions.pause(entry.sessionId)
      throw new Error('Resume blocked')
    }
    return this.snapshot(tabId)
  }
  /** For a revoked binding, independently reconcile before retiring; never resumes. */
  reconcileRevokedForRetirement(tabId: string, observed: BridgeTarget): void {
    const cleanTarget = copyPlainTarget(observed)
    const entry = this.entry(tabId)
    const gate = this.gate.snapshot(tabId)
    if (
      entry.running ||
      gate.running ||
      this.signalingAll ||
      this.signalingTabs.has(tabId) ||
      this.sessions.snapshot(entry.sessionId).phase !== 'revoked'
    )
      throw new Error('Reconciliation blocked')
    this.sessions.acknowledgeRevokedUncertainty(entry.sessionId, cleanTarget)
    if (gate.state === 'uncertain') this.gate.acknowledgeUncertainty(tabId)
  }

  /** Retire only after actual settlement and uncertainty reconciliation. */
  retire(tabId: string): void {
    const entry = this.entry(tabId)
    const gate = this.gate.snapshot(tabId)
    if (
      this.signalingAll ||
      this.signalingTabs.has(tabId) ||
      entry.running ||
      gate.running ||
      gate.state === 'uncertain' ||
      this.sessions.snapshot(entry.sessionId).phase === 'uncertain'
    )
      throw new Error('Cannot retire unresolved action')
    // Fail closed if a later cleanup step fails: revoked sessions cannot resume.
    this.sessions.revoke(entry.sessionId)
    this.sessions.assertRevokedSettled(entry.sessionId)
    this.gate.unregister(tabId)
    this.sessions.forgetRevoked(entry.sessionId)
    this.entries.delete(tabId)
  }
}
