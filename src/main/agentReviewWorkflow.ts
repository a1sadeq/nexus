import {
  AgentReviewLedger,
  type ReviewRecordSnapshot,
  type TrustedReviewDecision
} from './agentReviewLedger'
import { reviewIdentity, type ReviewMaterial } from './agentReviewIdentity'

/**
 * Unwired in-memory evidence workflow. It performs NO file changes, tests or
 * merges, and grants NO authority. All material, decision provenance, actual
 * bytes, scope, sandbox and dirty-destination safety require independent proof.
 */
export type WorkflowState =
  | 'new'
  | 'proposal-review'
  | 'proposal-reviewed'
  | 'post-review'
  | 'post-reviewed'
  | 'merge-review'
  | 'merge-reviewed'
  | 'blocked'

function canonicalArtifact(material: ReviewMaterial): string {
  // Validates all input first; identity is a consistency hash, not authenticity.
  reviewIdentity(material)
  const files = material.files
    .map((file) => ({ path: file.path, kind: file.kind, contentHash: file.contentHash }))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  return JSON.stringify({
    sessionId: material.sessionId,
    targetBindingId: material.targetBindingId,
    grantRevision: material.grantRevision,
    projectId: material.projectId,
    worktreeId: material.worktreeId,
    baseRevision: material.baseRevision,
    treeHash: material.treeHash,
    patchHash: material.patchHash,
    files
  })
}
function cloneMaterial(material: ReviewMaterial): ReviewMaterial {
  try {
    return structuredClone(material)
  } catch {
    throw new Error('Invalid material')
  }
}

export class AgentReviewWorkflow {
  private readonly ledger = new AgentReviewLedger()
  private state: WorkflowState = 'new'
  private artifact: string | null = null
  private current: ReviewRecordSnapshot | null = null

  snapshot(): { state: WorkflowState; review: ReviewRecordSnapshot | null } {
    return {
      state: this.state,
      review: this.current ? this.ledger.snapshot(this.current.reviewId) : null
    }
  }

  private open(
    material: ReviewMaterial,
    stage: ReviewMaterial['stage'],
    expected: WorkflowState,
    next: WorkflowState
  ): ReviewRecordSnapshot {
    if (this.state !== expected) throw new Error('Workflow step blocked')
    let copy: ReviewMaterial, artifact: string
    try {
      copy = cloneMaterial(material)
      artifact = canonicalArtifact(copy)
      if (copy.stage !== stage || (this.artifact !== null && artifact !== this.artifact))
        throw new Error('Artifact changed')
    } catch {
      // Do not overwrite a terminal or advanced state if a getter reentered.
      if (this.state === expected) this.state = 'blocked'
      throw new Error('Review material invalid or changed')
    }
    if (this.state !== expected) throw new Error('Workflow changed during validation')
    try {
      const review = this.ledger.open(copy)
      if (this.artifact === null) this.artifact = artifact
      this.current = review
      this.state = next
      return this.ledger.snapshot(review.reviewId)
    } catch {
      this.state = 'blocked'
      throw new Error('Review could not be opened')
    }
  }

  startProposal(material: ReviewMaterial): ReviewRecordSnapshot {
    return this.open(material, 'proposal', 'new', 'proposal-review')
  }

  /** Trusted adapter must separately authenticate/correlate the decision. */
  recordDecision(decision: TrustedReviewDecision): ReviewRecordSnapshot {
    if (!this.current || !['proposal-review', 'post-review', 'merge-review'].includes(this.state))
      throw new Error('No review awaiting decision')
    const previousState = this.state
    try {
      const result = this.ledger.recordTrustedDecision(this.current.reviewId, decision)
      if (result.state === 'rejected') this.state = 'blocked'
      return result
    } catch {
      if (this.state === previousState) this.state = 'blocked'
      throw new Error('Review decision rejected')
    }
  }

  /** Records matching exact material at a step; does not perform the next step. */
  accept(current: ReviewMaterial): void {
    if (!this.current) throw new Error('No current review')
    const next: Partial<Record<WorkflowState, WorkflowState>> = {
      'proposal-review': 'proposal-reviewed',
      'post-review': 'post-reviewed',
      'merge-review': 'merge-reviewed'
    }
    const previousState = this.state,
      nextState = next[previousState]
    if (!nextState) throw new Error('Workflow step blocked')
    try {
      this.ledger.consume(this.current.reviewId, current)
      if (this.state !== previousState) throw new Error('Workflow changed')
      this.state = nextState
    } catch {
      if (this.state === previousState) this.state = 'blocked'
      throw new Error('Review could not be accepted')
    }
  }

  /** Only after independently verified application and post-change tests. */
  startPostApply(actual: ReviewMaterial): ReviewRecordSnapshot {
    return this.open(actual, 'post-apply', 'proposal-reviewed', 'post-review')
  }

  /** Does not verify destination dirtiness, merge safety or conflicts. */
  startMergeReview(material: ReviewMaterial): ReviewRecordSnapshot {
    return this.open(material, 'merge', 'post-reviewed', 'merge-review')
  }

  /** Stop/revoke/identity change is terminal for this in-memory workflow. */
  invalidate(): void {
    if (this.current) this.ledger.invalidateSession(this.currentSessionId())
    this.state = 'blocked'
  }

  private currentSessionId(): string {
    // `artifact` is our private JSON-encoded canonical record.
    if (!this.artifact) throw new Error('No artifact')
    const parsed: unknown = JSON.parse(this.artifact)
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      typeof (parsed as { sessionId?: unknown }).sessionId !== 'string'
    )
      throw new Error('Invalid artifact')
    return (parsed as { sessionId: string }).sessionId
  }
}
