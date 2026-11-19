import { randomUUID } from 'node:crypto'
import { hashReviewBytes, reviewIdentity, type ReviewMaterial } from './agentReviewIdentity'

/**
 * Unwired in-memory review bookkeeping. This is NOT a write gate, verified
 * provider reply, IPC boundary, sandbox, filesystem snapshot or permission.
 * Material and decisions must be supplied by an independently trusted owner.
 */
export type ReviewRecordState = 'awaiting' | 'approved' | 'rejected' | 'invalidated' | 'consumed'
export interface ReviewRecordSnapshot {
  reviewId: string
  identity: string
  state: ReviewRecordState
  requiredExceptions: string[]
  hasFailedEvidence: boolean
}
interface RecordEntry {
  id: string
  identity: string
  context: string
  sessionId: string
  state: ReviewRecordState
  exceptions: string[]
  failed: boolean
}
export type TrustedReviewDecision =
  | { decision: 'reject'; reviewIdentity: string }
  | { decision: 'approve'; reviewIdentity: string; acceptedExceptions: string[] }

const MAX_RECORDS = 256

function copyMaterial(material: ReviewMaterial): ReviewMaterial {
  // Prevent ordinary caller mutation from altering the checks after hashing.
  // Caller must still independently obtain accurate bytes and enumerate files.
  try {
    return structuredClone(material)
  } catch {
    throw new Error('Invalid review material')
  }
}
function derive(material: ReviewMaterial): {
  identity: string
  sessionId: string
  context: string
  exceptions: string[]
  failed: boolean
} {
  const identity = reviewIdentity(material)
  const exceptions = new Set<string>()
  if (material.evidence.length === 0) exceptions.add('evidence:none')
  for (const item of material.evidence) {
    if (item.status === 'not-run' || item.status === 'unavailable')
      exceptions.add(`evidence:${item.id}`)
  }
  for (const omission of material.omissions)
    exceptions.add(`omission:${hashReviewBytes(Buffer.from(omission, 'utf8'))}`)
  return {
    identity,
    sessionId: material.sessionId,
    // JSON encoding avoids separator collisions. Distinct stages are separate
    // review contexts; changing any exact material still requires a new review.
    context: JSON.stringify([
      material.sessionId,
      material.projectId,
      material.worktreeId,
      material.stage
    ]),
    exceptions: [...exceptions].sort(),
    failed: material.evidence.some((item) => item.status === 'failed')
  }
}
function copyExceptions(values: unknown): string[] | null {
  if (
    !Array.isArray(values) ||
    values.length > 2001 ||
    !values.every((value) => typeof value === 'string' && value.length > 0 && value.length <= 1100)
  )
    return null
  const set = new Set(values)
  if (set.size !== values.length) return null
  return [...set].sort()
}
function sameList(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index])
}

export class AgentReviewLedger {
  private readonly records = new Map<string, RecordEntry>()

  private entry(id: string): RecordEntry {
    const entry = this.records.get(id)
    if (!entry) throw new Error('Unknown review')
    return entry
  }

  snapshot(id: string): ReviewRecordSnapshot {
    const e = this.entry(id)
    return {
      reviewId: e.id,
      identity: e.identity,
      state: e.state,
      requiredExceptions: [...e.exceptions],
      hasFailedEvidence: e.failed
    }
  }

  /** Create a new request; any earlier live request for the same context is invalidated. */
  open(material: ReviewMaterial): ReviewRecordSnapshot {
    const data = derive(copyMaterial(material))
    if (this.records.size >= MAX_RECORDS) throw new Error('Review record limit reached')
    for (const entry of this.records.values()) {
      if (
        entry.context === data.context &&
        (entry.state === 'awaiting' || entry.state === 'approved')
      )
        entry.state = 'invalidated'
    }
    const id = randomUUID()
    this.records.set(id, { id, ...data, state: 'awaiting' })
    return this.snapshot(id)
  }

  /**
   * This is an assertion from a trusted adapter that has separately verified
   * the source, correlation and meaning. Never feed raw provider output here.
   */
  recordTrustedDecision(id: string, decision: TrustedReviewDecision): ReviewRecordSnapshot {
    const e = this.entry(id)
    if (e.state !== 'awaiting') throw new Error('Review is not awaiting a decision')
    let copy: TrustedReviewDecision
    try {
      copy = structuredClone(decision)
    } catch {
      if (e.state === 'awaiting') e.state = 'invalidated'
      throw new Error('Invalid review decision')
    }
    // Defensive recheck: structured cloning can invoke caller-supplied getters.
    if (e.state !== 'awaiting') throw new Error('Review is no longer awaiting a decision')
    if (
      !copy ||
      typeof copy !== 'object' ||
      copy.reviewIdentity !== e.identity ||
      (copy.decision !== 'approve' && copy.decision !== 'reject')
    ) {
      e.state = 'invalidated'
      throw new Error('Invalid review decision')
    }
    if (copy.decision === 'reject') {
      e.state = 'rejected'
      return this.snapshot(id)
    }
    const accepted = copyExceptions(copy.acceptedExceptions)
    if (e.failed || !accepted || !sameList(accepted, e.exceptions)) {
      e.state = 'invalidated'
      throw new Error('Approval missing required conditions')
    }
    e.state = 'approved'
    return this.snapshot(id)
  }

  /**
   * One-shot bookkeeping assertion, NOT permission to apply. The owner must
   * independently validate current identities, authorization, authoritative
   * bytes/inventory and real enforcement immediately at the effect boundary.
   */
  consume(id: string, current: ReviewMaterial): ReviewRecordSnapshot {
    const e = this.entry(id)
    if (e.state !== 'approved') throw new Error('Review is not approved')
    let now: ReturnType<typeof derive>
    try {
      now = derive(copyMaterial(current))
    } catch {
      if (e.state === 'approved') e.state = 'invalidated'
      throw new Error('Current review material invalid')
    }
    if (e.state !== 'approved') throw new Error('Review no longer approved')
    if (now.identity !== e.identity || now.context !== e.context) {
      e.state = 'invalidated'
      throw new Error('Review material changed')
    }
    e.state = 'consumed'
    return this.snapshot(id)
  }

  invalidateSession(sessionId: string): void {
    if (typeof sessionId !== 'string' || !sessionId.trim() || sessionId.length > 1024)
      throw new Error('Invalid session ID')
    for (const e of this.records.values())
      if (e.sessionId === sessionId && (e.state === 'awaiting' || e.state === 'approved'))
        e.state = 'invalidated'
  }

  forget(id: string): void {
    const e = this.entry(id)
    if (e.state === 'awaiting' || e.state === 'approved')
      throw new Error('Live review cannot be forgotten')
    this.records.delete(id)
  }
}
