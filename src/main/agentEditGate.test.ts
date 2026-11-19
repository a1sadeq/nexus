import { describe, it, expect } from 'vitest'
import {
  contentHashOf,
  describeEditDecision,
  evaluateEdit,
  type EditGateInput
} from './agentEditGate'
import { hashReviewBytes, reviewIdentity, type ReviewMaterial } from './agentReviewIdentity'
import type { ContainmentState } from './agentContainment'
import type { GrantCheck } from './agentGrants'

const PROPOSED = 'export const value = 2\n'
const TREE = hashReviewBytes(new TextEncoder().encode('tree-snapshot'))

const material = (overrides: Partial<ReviewMaterial> = {}): ReviewMaterial => ({
  sessionId: 'session-1',
  targetBindingId: 'binding-1',
  grantRevision: 1,
  stage: 'proposal',
  projectId: 'proj-1',
  worktreeId: 'wt-1',
  baseRevision: 'rev-1',
  treeHash: TREE,
  patchHash: hashReviewBytes(new TextEncoder().encode('patch-bytes')),
  files: [{ path: 'src/value.ts', kind: 'modified', contentHash: contentHashOf(PROPOSED) }],
  evidence: [{ id: 'tests', status: 'passed', contentHash: hashReviewBytes(new TextEncoder().encode('ok')) }],
  omissions: [],
  ...overrides
})

const approved = (mat: ReviewMaterial): unknown => ({
  decision: 'approve',
  reviewIdentity: reviewIdentity(mat)
})

const grantOk: GrantCheck = {
  allowed: true,
  grant: {
    grantId: 'g1',
    clientId: 'c1',
    agentSessionId: 'session-1',
    projectId: 'proj-1',
    worktreeId: 'wt-1',
    conversationId: 'conv-1',
    actions: ['prepare-edit'],
    approvedPaths: ['/home/user/project'],
    autoSend: false,
    revision: 1,
    issuedAt: 0,
    expiresAt: 1,
    revokedAt: null,
    revocationReason: null
  }
}

const grantDenied: GrantCheck = {
  allowed: false,
  code: 'revoked',
  message: 'This grant was revoked.'
}

const enforced: ContainmentState = {
  state: 'enforced',
  mechanism: 'bubblewrap',
  proof: '2 hostile fixtures blocked'
}
const blockedByPolicy: ContainmentState = {
  state: 'blocked',
  reason: 'Autonomous edits are switched off by policy.',
  capabilities: { bubblewrap: false, landlock: false, userNamespaces: false, checkedAt: 0, evidence: [] }
}
const unavailable: ContainmentState = {
  state: 'unavailable',
  reason: 'No sandbox mechanism was found on this machine.',
  capabilities: { bubblewrap: false, landlock: false, userNamespaces: false, checkedAt: 0, evidence: [] }
}

const base = (overrides: Partial<EditGateInput> = {}): EditGateInput => {
  const mat = material()
  return {
    material: mat,
    request: {
      relativePath: 'src/value.ts',
      targetWorktreeId: 'wt-1',
      baseRevision: 'rev-1',
      proposedContentHash: contentHashOf(PROPOSED)
    },
    grant: grantOk,
    containment: enforced,
    approval: approved(mat),
    currentTreeHash: TREE,
    ...overrides
  }
}

describe('the happy path', () => {
  it('allows exactly the reviewed bytes on the reviewed tree', () => {
    const decision = evaluateEdit(base())
    expect(decision.allowed).toBe(true)
    expect(decision.codes).toEqual([])
    expect(decision.testsPassed).toBe(true)
    expect(describeEditDecision(decision)).toContain('test evidence')
  })
})

describe('containment', () => {
  it('refuses every edit under the current block-only policy', () => {
    const decision = evaluateEdit(base({ containment: blockedByPolicy }))
    expect(decision.allowed).toBe(false)
    expect(decision.codes).toContain('edits-disabled-by-policy')
    expect(decision.blockers.join(' ')).toContain('switched off by policy')
  })

  it('distinguishes "policy says no" from "no proof"', () => {
    const decision = evaluateEdit(base({ containment: unavailable }))
    expect(decision.codes).toContain('no-proven-containment')
    expect(decision.blockers.join(' ')).toContain('No sandbox mechanism')
  })
})

describe('grants', () => {
  it('refuses when the grant was revoked, even with a valid approval', () => {
    const decision = evaluateEdit(base({ grant: grantDenied }))
    expect(decision.allowed).toBe(false)
    expect(decision.codes).toContain('grant-revoked')
  })
})

describe('approval binding', () => {
  it('refuses an approval for a different patch', () => {
    const other = material({ files: [{ path: 'src/value.ts', kind: 'modified', contentHash: contentHashOf('other') }] })
    const decision = evaluateEdit(base({ approval: approved(other) }))
    expect(decision.allowed).toBe(false)
    expect(decision.codes).toContain('approval-mismatch')
  })

  it('refuses the same patch approved against a different base', () => {
    const otherBase = material({ baseRevision: 'rev-0' })
    const decision = evaluateEdit(base({ approval: approved(otherBase) }))
    expect(decision.allowed).toBe(false)
    expect(decision.allowed).toBe(false)
    expect(decision.codes).toContain('approval-mismatch')
  })

  it('refuses an approval for another worktree', () => {
    const otherTree = material({ worktreeId: 'wt-2' })
    const decision = evaluateEdit(base({ approval: approved(otherTree) }))
    expect(decision.allowed).toBe(false)
    expect(decision.codes).toContain('approval-mismatch')
  })

  it('refuses an approval that is only a plausible-looking string', () => {
    const decision = evaluateEdit(base({ approval: 'approve' }))
    expect(decision.allowed).toBe(false)
    expect(decision.codes).toContain('approval-mismatch')
  })

  it('refuses a "reject" decision carrying the right identity', () => {
    const mat = material()
    const decision = evaluateEdit(
      base({ approval: { decision: 'reject', reviewIdentity: reviewIdentity(mat) } })
    )
    expect(decision.allowed).toBe(false)
  })

  it('refuses an approval for the wrong stage of the flow', () => {
    const decision = evaluateEdit(base({ requiredStage: 'merge' }))
    expect(decision.allowed).toBe(false)
    expect(decision.codes).toContain('stage-mismatch')
  })
})

describe('what is on disk right now', () => {
  it('refuses when the worktree changed after review', () => {
    const decision = evaluateEdit(base({ currentTreeHash: hashReviewBytes(new TextEncoder().encode('moved')) }))
    expect(decision.allowed).toBe(false)
    expect(decision.codes).toContain('tree-changed')
    expect(decision.blockers.join(' ')).toContain('fresh review')
  })

  it('refuses bytes that differ from the reviewed ones', () => {
    const decision = evaluateEdit(
      base({
        request: {
          relativePath: 'src/value.ts',
          targetWorktreeId: 'wt-1',
          baseRevision: 'rev-1',
          proposedContentHash: contentHashOf('export const value = 3\n')
        }
      })
    )
    expect(decision.allowed).toBe(false)
    expect(decision.codes).toContain('content-mismatch')
  })

  it('refuses a file that was not part of the review', () => {
    const decision = evaluateEdit(
      base({
        request: {
          relativePath: 'src/other.ts',
          targetWorktreeId: 'wt-1',
          baseRevision: 'rev-1',
          proposedContentHash: contentHashOf(PROPOSED)
        }
      })
    )
    expect(decision.allowed).toBe(false)
    expect(decision.codes).toContain('file-not-reviewed')
  })

  it('refuses an absolute or traversing path', () => {
    for (const bad of ['/etc/passwd', '../../etc/passwd', 'src/../../x']) {
      const decision = evaluateEdit(
        base({
          request: {
            relativePath: bad,
            targetWorktreeId: 'wt-1',
            baseRevision: 'rev-1',
            proposedContentHash: contentHashOf(PROPOSED)
          }
        })
      )
      expect(decision.allowed).toBe(false)
      expect(decision.codes).toContain('unsafe-path')
    }
  })

  it('reports a base or worktree mismatch between request and material', () => {
    const wrongBase = evaluateEdit(
      base({
        request: {
          relativePath: 'src/value.ts',
          targetWorktreeId: 'wt-1',
          baseRevision: 'rev-9',
          proposedContentHash: contentHashOf(PROPOSED)
        }
      })
    )
    expect(wrongBase.codes).toContain('base-mismatch')

    const wrongTree = evaluateEdit(
      base({
        request: {
          relativePath: 'src/value.ts',
          targetWorktreeId: 'wt-9',
          baseRevision: 'rev-1',
          proposedContentHash: contentHashOf(PROPOSED)
        }
      })
    )
    expect(wrongTree.codes).toContain('worktree-mismatch')
  })
})

describe('honesty about evidence', () => {
  it('does not claim tests passed when they were not run', () => {
    const mat = material({
      evidence: [{ id: 'tests', status: 'not-run', contentHash: null }]
    })
    const decision = evaluateEdit(base({ material: mat, approval: approved(mat) }))
    expect(decision.allowed).toBe(true)
    expect(decision.testsPassed).toBe(false)
    expect(describeEditDecision(decision)).toContain('no passing test evidence')
  })

  it('records declared gaps verbatim', () => {
    const mat = material({
      evidence: [{ id: 'tests', status: 'unavailable', contentHash: null }],
      omissions: ['integration tests need a database']
    })
    const decision = evaluateEdit(base({ material: mat, approval: approved(mat) }))
    expect(decision.omissions).toEqual(['integration tests need a database'])
    expect(describeEditDecision(decision)).toContain('integration tests need a database')
  })

  it('reports every blocker, not just the first', () => {
    const decision = evaluateEdit(
      base({ containment: blockedByPolicy, grant: grantDenied, approval: null })
    )
    expect(decision.codes.length).toBeGreaterThanOrEqual(3)
    expect(decision.blockers.length).toBeGreaterThanOrEqual(3)
  })

  it('refuses invalid review material instead of throwing', () => {
    const broken = material({ treeHash: 'not-a-hash' })
    const decision = evaluateEdit(base({ material: broken, approval: approved(material()) }))
    expect(decision.allowed).toBe(false)
    expect(decision.codes).toContain('invalid-review-material')
    expect(decision.reviewIdentity).toBe('')
  })
})
