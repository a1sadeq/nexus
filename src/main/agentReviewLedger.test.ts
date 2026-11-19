import { describe, expect, it } from 'vitest'
import { AgentReviewLedger } from './agentReviewLedger'
import type { ReviewMaterial } from './agentReviewIdentity'

function material(): ReviewMaterial {
  return {
    sessionId: 'session',
    targetBindingId: 'binding',
    grantRevision: 1,
    stage: 'proposal',
    projectId: 'project',
    worktreeId: 'tree',
    baseRevision: 'base',
    treeHash: 'a'.repeat(64),
    patchHash: 'b'.repeat(64),
    files: [{ path: 'src/a.ts', kind: 'modified', contentHash: 'c'.repeat(64) }],
    evidence: [{ id: 'unit', status: 'passed', contentHash: 'd'.repeat(64) }],
    omissions: []
  }
}

describe('unwired review assertion ledger', () => {
  it('records an exact approved identity and consumes it once', () => {
    const ledger = new AgentReviewLedger(),
      m = material(),
      r = ledger.open(m)
    expect(r.state).toBe('awaiting')
    ledger.recordTrustedDecision(r.reviewId, {
      decision: 'approve',
      reviewIdentity: r.identity,
      acceptedExceptions: []
    })
    expect(ledger.consume(r.reviewId, material()).state).toBe('consumed')
    expect(() => ledger.consume(r.reviewId, material())).toThrow()
  })
  it('invalidates an approval if any content identity changes before consumption', () => {
    const ledger = new AgentReviewLedger(),
      m = material(),
      r = ledger.open(m)
    ledger.recordTrustedDecision(r.reviewId, {
      decision: 'approve',
      reviewIdentity: r.identity,
      acceptedExceptions: []
    })
    m.files[0].contentHash = 'e'.repeat(64)
    expect(() => ledger.consume(r.reviewId, m)).toThrow('changed')
    expect(ledger.snapshot(r.reviewId).state).toBe('invalidated')
  })
  it('requires explicit recorded exceptions for missing tests and context', () => {
    const ledger = new AgentReviewLedger(),
      m = material()
    m.evidence = [
      { id: 'integration', status: 'unavailable', contentHash: null },
      { id: 'lint', status: 'not-run', contentHash: null }
    ]
    m.omissions = ['No staging results']
    const r = ledger.open(m)
    expect(r.requiredExceptions).toHaveLength(3)
    expect(() =>
      ledger.recordTrustedDecision(r.reviewId, {
        decision: 'approve',
        reviewIdentity: r.identity,
        acceptedExceptions: ['evidence:integration']
      })
    ).toThrow()
    expect(ledger.snapshot(r.reviewId).state).toBe('invalidated')
    const fresh = ledger.open(m)
    expect(
      ledger.recordTrustedDecision(fresh.reviewId, {
        decision: 'approve',
        reviewIdentity: fresh.identity,
        acceptedExceptions: fresh.requiredExceptions
      }).state
    ).toBe('approved')
  })
  it('does not misrepresent absent evidence as passed', () => {
    const ledger = new AgentReviewLedger(),
      m = material()
    m.evidence = []
    const r = ledger.open(m)
    expect(r.requiredExceptions).toEqual(['evidence:none'])
    expect(() =>
      ledger.recordTrustedDecision(r.reviewId, {
        decision: 'approve',
        reviewIdentity: r.identity,
        acceptedExceptions: []
      })
    ).toThrow()
  })
  it('blocks approval when evidence failed, even with exceptions', () => {
    const ledger = new AgentReviewLedger(),
      m = material()
    m.evidence[0] = { id: 'unit', status: 'failed', contentHash: 'd'.repeat(64) }
    const r = ledger.open(m)
    expect(r.hasFailedEvidence).toBe(true)
    expect(() =>
      ledger.recordTrustedDecision(r.reviewId, {
        decision: 'approve',
        reviewIdentity: r.identity,
        acceptedExceptions: []
      })
    ).toThrow()
  })
  it('can record rejection, never consume it, and permits forgetting terminal records', () => {
    const ledger = new AgentReviewLedger(),
      r = ledger.open(material())
    expect(
      ledger.recordTrustedDecision(r.reviewId, { decision: 'reject', reviewIdentity: r.identity })
        .state
    ).toBe('rejected')
    expect(() => ledger.consume(r.reviewId, material())).toThrow()
    ledger.forget(r.reviewId)
    expect(() => ledger.snapshot(r.reviewId)).toThrow()
  })
  it('invalidates a previous live review only in the same exact worktree and stage context', () => {
    const ledger = new AgentReviewLedger(),
      m = material(),
      first = ledger.open(m)
    const other = ledger.open({ ...m, stage: 'post-apply' })
    const next = ledger.open({ ...m, patchHash: 'e'.repeat(64) })
    expect(ledger.snapshot(first.reviewId).state).toBe('invalidated')
    expect(ledger.snapshot(other.reviewId).state).toBe('awaiting')
    expect(next.state).toBe('awaiting')
  })
  it('rejects decisions for another review identity', () => {
    const ledger = new AgentReviewLedger(),
      r = ledger.open(material())
    expect(() =>
      ledger.recordTrustedDecision(r.reviewId, {
        decision: 'approve',
        reviewIdentity: 'wrong',
        acceptedExceptions: []
      })
    ).toThrow()
    expect(ledger.snapshot(r.reviewId).state).toBe('invalidated')
  })
  it('invalidates live records on session revocation without touching terminal records', () => {
    const ledger = new AgentReviewLedger(),
      a = ledger.open(material())
    const b = ledger.open({ ...material(), sessionId: 'other' })
    ledger.invalidateSession('session')
    expect(ledger.snapshot(a.reviewId).state).toBe('invalidated')
    expect(ledger.snapshot(b.reviewId).state).toBe('awaiting')
  })
  it('copies snapshots and material so caller mutation cannot silently change identity', () => {
    const ledger = new AgentReviewLedger(),
      m = material()
    m.omissions = ['missing']
    const r = ledger.open(m)
    r.requiredExceptions.length = 0
    m.omissions = []
    expect(ledger.snapshot(r.reviewId).requiredExceptions).toHaveLength(1)
  })
  it('rejects duplicate or extra exceptions', () => {
    const ledger = new AgentReviewLedger(),
      r = ledger.open(material())
    expect(() =>
      ledger.recordTrustedDecision(r.reviewId, {
        decision: 'approve',
        reviewIdentity: r.identity,
        acceptedExceptions: ['x', 'x']
      })
    ).toThrow()
  })
  it('invalidates malformed current evidence rather than leaving an approval usable', () => {
    const ledger = new AgentReviewLedger(),
      r = ledger.open(material())
    ledger.recordTrustedDecision(r.reviewId, {
      decision: 'approve',
      reviewIdentity: r.identity,
      acceptedExceptions: []
    })
    const bad = { ...material(), files: [] }
    expect(() => ledger.consume(r.reviewId, bad)).toThrow()
    expect(ledger.snapshot(r.reviewId).state).toBe('invalidated')
  })
  it('does not forget live records', () => {
    const ledger = new AgentReviewLedger(),
      r = ledger.open(material())
    expect(() => ledger.forget(r.reviewId)).toThrow('Live review')
  })
  it('refuses late decisions if a decision getter supersedes the review during cloning', () => {
    const ledger = new AgentReviewLedger(),
      r = ledger.open(material())
    const decision = {
      decision: 'approve' as const,
      get reviewIdentity(): string {
        ledger.open(material())
        return r.identity
      },
      acceptedExceptions: []
    }
    expect(() => ledger.recordTrustedDecision(r.reviewId, decision)).toThrow()
    expect(ledger.snapshot(r.reviewId).state).toBe('invalidated')
  })
  it('rejects consumption when material cloning invalidates the session reentrantly', () => {
    const ledger = new AgentReviewLedger(),
      r = ledger.open(material())
    ledger.recordTrustedDecision(r.reviewId, {
      decision: 'approve',
      reviewIdentity: r.identity,
      acceptedExceptions: []
    })
    const m = {
      ...material(),
      get sessionId(): string {
        ledger.invalidateSession('session')
        return 'session'
      }
    }
    expect(() => ledger.consume(r.reviewId, m)).toThrow()
    expect(ledger.snapshot(r.reviewId).state).toBe('invalidated')
  })
})
