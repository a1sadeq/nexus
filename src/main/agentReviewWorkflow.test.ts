import { describe, expect, it } from 'vitest'
import { AgentReviewWorkflow } from './agentReviewWorkflow'
import type { ReviewMaterial } from './agentReviewIdentity'

function material(stage: ReviewMaterial['stage'] = 'proposal'): ReviewMaterial {
  return {
    sessionId: 'session',
    targetBindingId: 'binding',
    grantRevision: 1,
    stage,
    projectId: 'project',
    worktreeId: 'tree',
    baseRevision: 'base',
    treeHash: 'a'.repeat(64),
    patchHash: 'b'.repeat(64),
    files: [{ path: 'src/file.ts', kind: 'modified', contentHash: 'c'.repeat(64) }],
    evidence: [{ id: 'test', status: 'passed', contentHash: 'd'.repeat(64) }],
    omissions: []
  }
}
function approve(w: AgentReviewWorkflow, stage: ReviewMaterial['stage']): void {
  const r = w.snapshot().review!
  w.recordDecision({
    decision: 'approve',
    reviewIdentity: r.identity,
    acceptedExceptions: r.requiredExceptions
  })
  w.accept(material(stage))
}

describe('offline review workflow bookkeeping', () => {
  it('requires separate exact reviews at proposal, post-apply and merge stages', () => {
    const w = new AgentReviewWorkflow()
    w.startProposal(material())
    approve(w, 'proposal')
    expect(w.snapshot().state).toBe('proposal-reviewed')
    w.startPostApply(material('post-apply'))
    approve(w, 'post-apply')
    expect(w.snapshot().state).toBe('post-reviewed')
    w.startMergeReview(material('merge'))
    approve(w, 'merge')
    expect(w.snapshot().state).toBe('merge-reviewed')
  })
  it('does not skip any review and does not treat an opened request as approval', () => {
    const w = new AgentReviewWorkflow()
    expect(() => w.startPostApply(material('post-apply'))).toThrow()
    w.startProposal(material())
    expect(() => w.accept(material())).toThrow()
    expect(w.snapshot().state).toBe('blocked')
  })
  it.each([
    'patchHash',
    'treeHash',
    'baseRevision',
    'targetBindingId',
    'projectId',
    'worktreeId'
  ] as const)('blocks a changed %s between proposal and post-apply', (key) => {
    const w = new AgentReviewWorkflow()
    w.startProposal(material())
    approve(w, 'proposal')
    const actual = material('post-apply')
    actual[key] = key.endsWith('Hash') ? 'f'.repeat(64) : 'different'
    expect(() => w.startPostApply(actual)).toThrow()
    expect(w.snapshot().state).toBe('blocked')
  })
  it('blocks an additional file or changed grant before post-apply review', () => {
    const w = new AgentReviewWorkflow()
    w.startProposal(material())
    approve(w, 'proposal')
    const actual = material('post-apply')
    actual.files.push({ path: 'generated.bin', kind: 'added', contentHash: 'e'.repeat(64) })
    expect(() => w.startPostApply(actual)).toThrow()
    const second = new AgentReviewWorkflow()
    second.startProposal(material())
    approve(second, 'proposal')
    expect(() => second.startPostApply({ ...material('post-apply'), grantRevision: 2 })).toThrow()
  })
  it('allows new post-change evidence, but requires a fresh identity and approval', () => {
    const w = new AgentReviewWorkflow()
    w.startProposal(material())
    approve(w, 'proposal')
    const actual = material('post-apply')
    actual.evidence.push({ id: 'post-test', status: 'passed', contentHash: 'e'.repeat(64) })
    const review = w.startPostApply(actual)
    w.recordDecision({
      decision: 'approve',
      reviewIdentity: review.identity,
      acceptedExceptions: []
    })
    w.accept(actual)
    expect(w.snapshot().state).toBe('post-reviewed')
  })
  it('rejects and blocks an unverified or mismatched decision identity', () => {
    const w = new AgentReviewWorkflow()
    w.startProposal(material())
    expect(() =>
      w.recordDecision({ decision: 'approve', reviewIdentity: 'wrong', acceptedExceptions: [] })
    ).toThrow()
    expect(w.snapshot().state).toBe('blocked')
  })
  it('blocks rejected proposals and requires a new workflow for revision', () => {
    const w = new AgentReviewWorkflow(),
      r = w.startProposal(material())
    w.recordDecision({ decision: 'reject', reviewIdentity: r.identity })
    expect(w.snapshot().state).toBe('blocked')
    expect(() => w.startProposal(material())).toThrow()
  })
  it('never accepts a changed evidence inventory after approval', () => {
    const w = new AgentReviewWorkflow(),
      r = w.startProposal(material())
    w.recordDecision({ decision: 'approve', reviewIdentity: r.identity, acceptedExceptions: [] })
    const changed = material()
    changed.evidence[0].status = 'failed'
    expect(() => w.accept(changed)).toThrow()
    expect(w.snapshot().state).toBe('blocked')
  })
  it('blocks on explicit invalidation and cannot be revived', () => {
    const w = new AgentReviewWorkflow(),
      r = w.startProposal(material())
    w.invalidate()
    expect(w.snapshot().state).toBe('blocked')
    expect(w.snapshot().review?.state).toBe('invalidated')
    expect(() =>
      w.recordDecision({ decision: 'approve', reviewIdentity: r.identity, acceptedExceptions: [] })
    ).toThrow()
  })
  it('cannot let a material getter restart a workflow during validation', () => {
    const w = new AgentReviewWorkflow()
    const m = {
      ...material(),
      get sessionId(): string {
        w.invalidate()
        return 'session'
      }
    }
    expect(() => w.startProposal(m)).toThrow()
    expect(w.snapshot().state).toBe('blocked')
  })
})
