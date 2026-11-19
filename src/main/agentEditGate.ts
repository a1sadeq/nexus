import {
  hashReviewBytes,
  matchesApprovedReview,
  reviewIdentity,
  type ReviewEvidence,
  type ReviewMaterial
} from './agentReviewIdentity'
import type { ContainmentState } from './agentContainment'
import type { GrantCheck } from './agentGrants'

/**
 * The edit gate (plan 01, steps 4–5).
 *
 * One question, answered honestly: *may these exact bytes be written to this exact worktree
 * right now?* Every fact is re-read at apply time and none is inferred:
 *
 *   1. containment is `enforced` — presence of a sandbox is not proof that it contains;
 *   2. the grant allows `prepare-edit` for this session, worktree and path;
 *   3. the review material still describes the tree that is on disk (same tree hash, same
 *      base revision, same per-file content hash) — a moved file cannot inherit an approval;
 *   4. an approval record matches the review identity of that material exactly.
 *
 * What the gate refuses to do: convert a partial match into a pass, or claim tests passed
 * because an approval exists. Evidence is reported as recorded — `not-run` stays `not-run`.
 */

export interface EditGateRequest {
  /** What the agent is asking to write, restated at apply time. */
  relativePath: string
  targetWorktreeId: string
  baseRevision: string
  /** SHA-256 of the exact proposed bytes for this one file. */
  proposedContentHash: string
}

export interface EditGateInput {
  material: ReviewMaterial
  request: EditGateRequest
  grant: GrantCheck
  containment: ContainmentState
  approval: unknown
  /** SHA-256 of the worktree as it exists right now (computed by the caller). */
  currentTreeHash: string
  /** Whether the approval authorises this exact stage of the flow. */
  requiredStage?: ReviewMaterial['stage']
}

export interface EditGateDecision {
  allowed: boolean
  /** Machine codes, for tests and the audit trail. */
  codes: string[]
  /** Every reason, in the order checked — the UI shows all of them, not just the first. */
  blockers: string[]
  reviewIdentity: string
  /** Evidence as recorded, never upgraded. Empty means nothing was recorded. */
  evidence: ReviewEvidence[]
  omissions: string[]
  testsPassed: boolean
}

const STAGE_LABEL: Record<ReviewMaterial['stage'], string> = {
  proposal: 'proposal',
  'post-apply': 'post-apply check',
  merge: 'merge'
}

export function evaluateEdit(input: EditGateInput): EditGateDecision {
  let identity: string
  try {
    identity = reviewIdentity(input.material)
  } catch (error) {
    return {
      allowed: false,
      codes: ['invalid-review-material'],
      blockers: [
        `The review material is not valid (${error instanceof Error ? error.message : 'unknown'}), so it cannot authorise anything.`
      ],
      reviewIdentity: '',
      evidence: [],
      omissions: [],
      testsPassed: false
    }
  }

  const codes: string[] = []
  const blockers: string[] = []
  const { material, request, grant, containment, approval } = input

  // 1) Containment. `blocked` (a policy decision) and `unavailable` (unproven) differ.
  if (containment.state === 'blocked') {
    codes.push('edits-disabled-by-policy')
    blockers.push(containment.reason)
  } else if (containment.state === 'unavailable') {
    codes.push('no-proven-containment')
    blockers.push(containment.reason)
  }

  // 2) Grant, re-checked now.
  if (!grant.allowed) {
    codes.push(`grant-${grant.code}`)
    blockers.push(grant.message)
  }

  // 3) Path shape. Absolute paths and traversal are refused before any file is opened.
  if (
    request.relativePath.startsWith('/') ||
    request.relativePath.includes('\\') ||
    request.relativePath.split('/').some((part) => part === '..' || part === '')
  ) {
    codes.push('unsafe-path')
    blockers.push('The edit must be a plain relative path inside the worktree.')
  }

  // 4) The material must describe what the agent claims it describes.
  if (material.worktreeId !== request.targetWorktreeId) {
    codes.push('worktree-mismatch')
    blockers.push('This review was prepared for a different worktree.')
  }
  if (material.baseRevision !== request.baseRevision) {
    codes.push('base-mismatch')
    blockers.push('This review was prepared against a different base revision.')
  }
  if (input.requiredStage && material.stage !== input.requiredStage) {
    codes.push('stage-mismatch')
    blockers.push(
      `This approval was issued for the ${STAGE_LABEL[material.stage]} stage, not the ${STAGE_LABEL[input.requiredStage]} stage.`
    )
  }

  // 5) The tree must still be the tree that was reviewed.
  if (typeof input.currentTreeHash === 'string' && input.currentTreeHash !== material.treeHash) {
    codes.push('tree-changed')
    blockers.push(
      'The worktree changed since this patch was reviewed, so the approval no longer describes it. Ask for a fresh review.'
    )
  }

  // 6) The file must be in the reviewed inventory, with the reviewed content hash.
  const reviewed = material.files.find((file) => file.path === request.relativePath)
  if (!reviewed) {
    codes.push('file-not-reviewed')
    blockers.push(`"${request.relativePath}" is not part of the reviewed change.`)
  } else if (reviewed.kind !== 'deleted' && reviewed.contentHash !== request.proposedContentHash) {
    codes.push('content-mismatch')
    blockers.push('The bytes about to be written differ from the bytes that were reviewed.')
  }

  // 7) The approval, bound to this exact identity.
  const approved = matchesApprovedReview(identity, approval)
  if (!approved) {
    codes.push('approval-mismatch')
    blockers.push(
      'No approval matches this exact content, base and target. A different patch — or the same patch on a different base — needs its own review.'
    )
  }

  const testsPassed = material.evidence.some((item) => item.status === 'passed')

  return {
    allowed: codes.length === 0,
    codes,
    blockers,
    reviewIdentity: identity,
    evidence: material.evidence.map((item) => ({ ...item })),
    omissions: [...material.omissions],
    testsPassed
  }
}

/** What the UI must say about a decision. Never upgrades "not run" into "verified". */
export function describeEditDecision(decision: EditGateDecision): string {
  if (!decision.allowed) {
    return `Blocked: ${decision.blockers.join(' ')}`
  }
  const evidence = decision.testsPassed
    ? 'test evidence recorded in the approval'
    : 'no passing test evidence recorded'
  const omissions = decision.omissions.length
    ? ` Declared gaps: ${decision.omissions.join('; ')}.`
    : ''
  return `Approved for these exact bytes (${evidence}).${omissions}`
}

/** Convenience for tests and callers that already hold exact bytes. */
export function contentHashOf(content: string | Uint8Array): string {
  return hashReviewBytes(typeof content === 'string' ? new TextEncoder().encode(content) : content)
}
