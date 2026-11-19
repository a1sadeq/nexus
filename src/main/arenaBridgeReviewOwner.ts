import { randomUUID } from 'node:crypto'
import {
  AgentBridgeCoordinator,
  type CoordinatedAction,
  type CoordinatedSnapshot
} from './agentBridgeCoordinator'
import { ArenaBridgeViewBinding } from './arenaBridgeViewBinding'
import { acquireArenaViewLease, type ArenaViewLease } from './arenaViewLease'
import type { ArenaViewRegistry } from './arenaViewRegistry'
import type { BridgeTarget } from './agentBridgeSession'
import type { ReviewMaterial } from './agentReviewIdentity'
import type { ReviewRecordSnapshot, TrustedReviewDecision } from './agentReviewLedger'
import { AgentReviewWorkflow, type WorkflowState } from './agentReviewWorkflow'

/**
 * Experimental trusted-main-process owner, not an IPC security boundary.
 * No provider send, process launch, file write, sandbox or merge is implemented.
 * The owner cannot verify account/chat identity, user grants or decisions.
 */
interface Entry {
  target: BridgeTarget
  lease: ArenaViewLease
  binding: ArenaBridgeViewBinding
  bindingId: string
  workflow: AgentReviewWorkflow | null
  action: CoordinatedAction | null
  invalidated: boolean
}
function plainTarget(input: BridgeTarget): BridgeTarget {
  try {
    const copy = structuredClone(input)
    for (const k of [
      'tabId',
      'providerId',
      'conversationId',
      'navigationEpoch',
      'agentSessionId',
      'projectId',
      'worktreeId'
    ] as const) {
      if (typeof copy?.[k] !== 'string' || !copy[k].trim() || copy[k].length > 1024)
        throw new Error('Invalid target')
    }
    return {
      tabId: copy.tabId,
      providerId: copy.providerId,
      conversationId: copy.conversationId,
      navigationEpoch: copy.navigationEpoch,
      agentSessionId: copy.agentSessionId,
      projectId: copy.projectId,
      worktreeId: copy.worktreeId
    }
  } catch {
    throw new Error('Invalid target')
  }
}

export class ArenaBridgeReviewOwner {
  private readonly coordinator = new AgentBridgeCoordinator()
  private readonly entries = new Map<string, Entry>()
  private stoppedAll = false

  private entry(tabId: string): Entry {
    const entry = this.entries.get(tabId)
    if (!entry) throw new Error('Unknown tab')
    return entry
  }

  private invalidateReview(entry: Entry, invalidateBinding = false): void {
    if (invalidateBinding) entry.invalidated = true
    entry.workflow?.invalidate()
  }

  private check(tabId: string): Entry {
    const entry = this.entry(tabId)
    if (this.stoppedAll || entry.invalidated) throw new Error('Bridge binding unavailable')
    try {
      entry.lease.assertCurrent()
    } catch {
      this.invalidateReview(entry, true)
      throw new Error('Bridge binding unavailable')
    }
    if (this.stoppedAll || entry.invalidated) throw new Error('Bridge binding unavailable')
    return entry
  }

  /** Call from trusted owner after independent identity validation, never from page IPC. */
  register(
    registry: ArenaViewRegistry,
    supplied: BridgeTarget
  ): { bindingId: string; session: CoordinatedSnapshot } {
    const target = plainTarget(supplied)
    if (this.stoppedAll || this.entries.has(target.tabId)) throw new Error('Registration blocked')
    const lease = acquireArenaViewLease(registry, target.tabId)
    let binding: ArenaBridgeViewBinding
    let entry: Entry | null = null
    try {
      this.coordinator.register(target)
      binding = new ArenaBridgeViewBinding(this.coordinator, lease, () => {
        if (entry) this.invalidateReview(entry, true)
      })
    } catch {
      lease.dispose()
      throw new Error('Registration failed')
    }
    entry = {
      target,
      lease,
      binding,
      bindingId: randomUUID(),
      workflow: null,
      action: null,
      invalidated: false
    }
    this.entries.set(target.tabId, entry)
    try {
      this.check(target.tabId)
    } catch {
      this.invalidateReview(entry, true)
      binding.dispose()
      throw new Error('Registration failed')
    }
    return { bindingId: entry.bindingId, session: this.coordinator.snapshot(target.tabId) }
  }

  grant(tabId: string, observed: BridgeTarget): CoordinatedSnapshot {
    this.check(tabId)
    try {
      const result = this.coordinator.grant(tabId, observed)
      this.check(tabId)
      return result
    } catch {
      this.invalidateReview(this.entry(tabId))
      throw new Error('Grant failed')
    }
  }

  begin(tabId: string, observed: BridgeTarget): CoordinatedAction {
    const entry = this.check(tabId)
    if (entry.action) throw new Error('Action already active')
    try {
      const action = entry.binding.begin(observed)
      entry.action = action
      return action
    } catch {
      this.invalidateReview(entry)
      throw new Error('Action could not begin')
    }
  }

  markSideEffectStarting(tabId: string, action: CoordinatedAction, observed: BridgeTarget): void {
    const entry = this.check(tabId)
    if (entry.action !== action) throw new Error('Stale action')
    try {
      entry.binding.markSideEffectStarting(action, observed)
    } catch {
      this.invalidateReview(entry)
      throw new Error('Dispatch could not be marked')
    }
  }

  complete(tabId: string, action: CoordinatedAction, observed: BridgeTarget): CoordinatedSnapshot {
    const entry = this.check(tabId)
    if (entry.action !== action) throw new Error('Stale action')
    try {
      const result = entry.binding.complete(action, observed)
      entry.action = null
      return result
    } catch {
      this.invalidateReview(entry)
      throw new Error('Action could not complete')
    }
  }

  /** Call only after the adapter actually settles; abort alone does not settle. */
  finishFailed(tabId: string, action: CoordinatedAction): CoordinatedSnapshot {
    const entry = this.entry(tabId)
    if (entry.action !== action) throw new Error('Stale action')
    this.invalidateReview(entry)
    const result = this.coordinator.finishFailed(action)
    if (entry.action === action) entry.action = null
    return result
  }

  private cleanMaterial(
    tabId: string,
    value: ReviewMaterial
  ): { entry: Entry; material: ReviewMaterial } {
    const entry = this.check(tabId)
    let material: ReviewMaterial
    try {
      material = structuredClone(value)
    } catch {
      this.invalidateReview(entry)
      throw new Error('Invalid review material')
    }
    this.check(tabId)
    const snapshot = this.coordinator.snapshot(tabId)
    const session = snapshot.session
    if (
      (session.phase !== 'ready' && session.phase !== 'busy') ||
      snapshot.gate.state === 'paused' ||
      snapshot.gate.state === 'uncertain' ||
      snapshot.gate.stopAllLatched
    )
      throw new Error('Session not active')
    if (
      material.sessionId !== session.sessionId ||
      material.targetBindingId !== entry.bindingId ||
      material.grantRevision !== session.grantRevision ||
      material.projectId !== entry.target.projectId ||
      material.worktreeId !== entry.target.worktreeId
    ) {
      this.invalidateReview(entry, true)
      entry.binding.dispose()
      throw new Error('Review binding mismatch')
    }
    return { entry, material }
  }

  startProposal(tabId: string, value: ReviewMaterial): ReviewRecordSnapshot {
    const { entry, material } = this.cleanMaterial(tabId, value)
    if (entry.workflow) entry.workflow.invalidate()
    const workflow = new AgentReviewWorkflow()
    entry.workflow = workflow
    const result = workflow.startProposal(material)
    this.check(tabId)
    return result
  }

  private workflow(tabId: string): AgentReviewWorkflow {
    const entry = this.check(tabId)
    if (!entry.workflow) throw new Error('No review workflow')
    const status = this.coordinator.snapshot(tabId)
    if (
      (status.session.phase !== 'ready' && status.session.phase !== 'busy') ||
      status.gate.state === 'paused' ||
      status.gate.state === 'uncertain' ||
      status.gate.stopAllLatched
    ) {
      this.invalidateReview(entry)
      throw new Error('Session not active')
    }
    return entry.workflow
  }

  recordDecision(tabId: string, decision: TrustedReviewDecision): ReviewRecordSnapshot {
    const workflow = this.workflow(tabId)
    const result = workflow.recordDecision(decision)
    if (this.workflow(tabId) !== workflow) throw new Error('Review changed')
    return result
  }

  accept(tabId: string, value: ReviewMaterial): void {
    const { entry, material } = this.cleanMaterial(tabId, value)
    if (!entry.workflow) throw new Error('No review workflow')
    entry.workflow.accept(material)
    this.check(tabId)
  }

  startPostApply(tabId: string, value: ReviewMaterial): ReviewRecordSnapshot {
    const { entry, material } = this.cleanMaterial(tabId, value)
    if (!entry.workflow) throw new Error('No review workflow')
    const result = entry.workflow.startPostApply(material)
    this.check(tabId)
    return result
  }

  startMergeReview(tabId: string, value: ReviewMaterial): ReviewRecordSnapshot {
    const { entry, material } = this.cleanMaterial(tabId, value)
    if (!entry.workflow) throw new Error('No review workflow')
    const result = entry.workflow.startMergeReview(material)
    this.check(tabId)
    return result
  }

  snapshot(tabId: string): {
    coordinator: CoordinatedSnapshot
    reviewState: WorkflowState | null
    invalidated: boolean
    stopFailed: boolean
  } {
    const entry = this.entry(tabId)
    return {
      coordinator: this.coordinator.snapshot(tabId),
      reviewState: entry.workflow?.snapshot().state ?? null,
      invalidated: entry.invalidated,
      stopFailed: entry.binding.status().stopFailed
    }
  }

  stop(tabId: string): CoordinatedSnapshot {
    const entry = this.entry(tabId)
    this.invalidateReview(entry)
    return this.coordinator.stop(tabId)
  }

  revoke(tabId: string): CoordinatedSnapshot {
    const entry = this.entry(tabId)
    this.invalidateReview(entry)
    return this.coordinator.revoke(tabId)
  }

  stopAll(): void {
    this.stoppedAll = true
    // Invalidate every review before any synchronous cancellation callback runs.
    for (const entry of this.entries.values()) this.invalidateReview(entry)
    this.coordinator.stopAll()
  }

  /** Independently verify and reconcile actual outcome; this never resumes. */
  acknowledgeUncertainty(tabId: string, observed: BridgeTarget): CoordinatedSnapshot {
    this.check(tabId)
    const result = this.coordinator.acknowledgeUncertainty(tabId, observed)
    this.check(tabId)
    return result
  }

  /** Only after independently verifying the original target and user grant. */
  resume(tabId: string, observed: BridgeTarget): CoordinatedSnapshot {
    this.check(tabId)
    const result = this.coordinator.resume(tabId, observed)
    this.check(tabId)
    return result
  }

  /** Releasing Stop All never automatically resumes a tab or review. */
  releaseStopAll(): void {
    this.coordinator.releaseStopAll()
    this.stoppedAll = false
  }

  /** Owner calls at teardown initiation, before awaiting native close. */
  dispose(tabId: string): void {
    const entry = this.entry(tabId)
    this.invalidateReview(entry, true)
    entry.binding.dispose()
  }
  /**
   * After independent reconciliation of an invalidated view's real outcome,
   * permit retirement only. This does not revive the old binding or grant.
   */
  reconcileForRetirement(tabId: string, observed: BridgeTarget): CoordinatedSnapshot {
    const entry = this.entry(tabId)
    if (!entry.invalidated || entry.action) throw new Error('Retirement reconciliation blocked')
    return this.coordinator.acknowledgeUncertainty(tabId, observed)
  }

  /** Independently reconcile revoked work only for retirement; never resumes it. */
  reconcileRevokedForRetirement(tabId: string, observed: BridgeTarget): void {
    const entry = this.entry(tabId)
    if (entry.action) throw new Error('Retirement reconciliation blocked')
    this.coordinator.reconcileRevokedForRetirement(tabId, observed)
  }

  /**
   * Forget a closed tab only after the adapter has actually settled and every
   * uncertain operation has been independently reconciled. Never force close.
   */
  retire(tabId: string): void {
    const entry = this.entry(tabId)
    const status = this.coordinator.snapshot(tabId)
    if (
      entry.action ||
      status.gate.running ||
      status.gate.state === 'uncertain' ||
      status.session.phase === 'uncertain'
    )
      throw new Error('Cannot retire unresolved action')
    this.invalidateReview(entry, true)
    entry.binding.dispose()
    if (entry.binding.status().stopFailed) throw new Error('Stop failed; cannot retire')
    this.coordinator.retire(tabId)
    this.entries.delete(tabId)
  }
}
