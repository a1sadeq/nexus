import { EventEmitter } from 'node:events'
import type { WebContents } from 'electron'
import { describe, expect, it } from 'vitest'
import { ArenaViewRegistry } from './arenaViewRegistry'
import { ArenaBridgeReviewOwner } from './arenaBridgeReviewOwner'
import type { BridgeTarget } from './agentBridgeSession'
import type { ReviewMaterial } from './agentReviewIdentity'

class Contents extends EventEmitter {
  constructor(readonly id: number) {
    super()
  }
  isDestroyed(): boolean {
    return false
  }
  getURL(): string {
    return 'https://arena.ai/'
  }
  async executeJavaScriptInIsolatedWorld(): Promise<unknown> {
    return null
  }
  wc(): WebContents {
    return this as unknown as WebContents
  }
}
function target(tabId = 'a'): BridgeTarget {
  return {
    tabId,
    providerId: 'arena',
    conversationId: `chat-${tabId}`,
    navigationEpoch: 'nav',
    agentSessionId: `agent-${tabId}`,
    projectId: 'project',
    worktreeId: `tree-${tabId}`
  }
}
function fixture(): {
  owner: ArenaBridgeReviewOwner
  registry: ArenaViewRegistry
  contents: Contents
  material: ReviewMaterial
} {
  const owner = new ArenaBridgeReviewOwner(),
    registry = new ArenaViewRegistry(),
    contents = new Contents(1)
  registry.register('a', contents.wc())
  const reg = owner.register(registry, target())
  owner.grant('a', target())
  return {
    owner,
    registry,
    contents,
    material: {
      sessionId: reg.session.session.sessionId,
      targetBindingId: reg.bindingId,
      grantRevision: 1,
      stage: 'proposal',
      projectId: 'project',
      worktreeId: 'tree-a',
      baseRevision: 'base',
      treeHash: 'a'.repeat(64),
      patchHash: 'b'.repeat(64),
      files: [{ path: 'src/a.ts', kind: 'modified', contentHash: 'c'.repeat(64) }],
      evidence: [{ id: 'tests', status: 'passed', contentHash: 'd'.repeat(64) }],
      omissions: []
    }
  }
}

describe('offline owner linking review invalidation to action and tab lifecycle', () => {
  it('tracks distinct exact proposal, post-apply and merge assertions without performing actions', () => {
    const { owner, material } = fixture()
    const proposal = owner.startProposal('a', material)
    owner.recordDecision('a', {
      decision: 'approve',
      reviewIdentity: proposal.identity,
      acceptedExceptions: []
    })
    owner.accept('a', material)
    const post = { ...material, stage: 'post-apply' as const }
    const postReview = owner.startPostApply('a', post)
    owner.recordDecision('a', {
      decision: 'approve',
      reviewIdentity: postReview.identity,
      acceptedExceptions: []
    })
    owner.accept('a', post)
    const merge = { ...material, stage: 'merge' as const },
      mergeReview = owner.startMergeReview('a', merge)
    owner.recordDecision('a', {
      decision: 'approve',
      reviewIdentity: mergeReview.identity,
      acceptedExceptions: []
    })
    owner.accept('a', merge)
    expect(owner.snapshot('a').reviewState).toBe('merge-reviewed')
  })
  it('invalidates the review before navigation signals cancellation to the running action', () => {
    const { owner, contents, material } = fixture(),
      action = owner.begin('a', target())
    owner.markSideEffectStarting('a', action, target())
    owner.startProposal('a', material)
    let called = false
    action.signal.addEventListener('abort', () => {
      called = true
      expect(owner.snapshot('a').reviewState).toBe('blocked')
    })
    contents.emit('did-start-navigation', { isMainFrame: true })
    expect(called).toBe(true)
    expect(owner.snapshot('a').coordinator.session.phase).toBe('uncertain')
    expect(owner.snapshot('a').invalidated).toBe(true)
    expect(() => owner.startProposal('a', material)).toThrow()
  })
  it('invalidates all tabs before any Stop All abort listener runs', () => {
    const { owner, registry, material } = fixture(),
      b = new Contents(2)
    registry.register('b', b.wc())
    const regB = owner.register(registry, target('b'))
    owner.grant('b', target('b'))
    const mB = {
      ...material,
      sessionId: regB.session.session.sessionId,
      targetBindingId: regB.bindingId,
      worktreeId: 'tree-b'
    }
    owner.startProposal('a', material)
    owner.startProposal('b', mB)
    const action = owner.begin('a', target())
    action.signal.addEventListener('abort', () =>
      expect(owner.snapshot('b').reviewState).toBe('blocked')
    )
    owner.stopAll()
    expect(action.signal.aborted).toBe(true)
    owner.releaseStopAll()
    expect(() => owner.startProposal('a', material)).toThrow()
    expect(() => owner.startProposal('b', mB)).toThrow()
  })
  it('cannot accept an approval after view replacement without an event', () => {
    const { owner, registry, material } = fixture(),
      review = owner.startProposal('a', material)
    owner.recordDecision('a', {
      decision: 'approve',
      reviewIdentity: review.identity,
      acceptedExceptions: []
    })
    registry.register('a', new Contents(2).wc())
    expect(() => owner.accept('a', material)).toThrow()
    expect(owner.snapshot('a').reviewState).toBe('blocked')
  })
  it('blocks materials associated with the wrong binding, session, project or worktree', () => {
    for (const key of ['sessionId', 'targetBindingId', 'projectId', 'worktreeId'] as const) {
      const { owner, material } = fixture()
      expect(() => owner.startProposal('a', { ...material, [key]: 'wrong' })).toThrow()
      expect(owner.snapshot('a').invalidated).toBe(true)
    }
  })
  it('does not permit approval before consent or after revocation', () => {
    const { owner, material } = fixture()
    owner.revoke('a')
    expect(() => owner.startProposal('a', material)).toThrow()
    expect(owner.snapshot('a').coordinator.session.phase).toBe('revoked')
  })
  it('cannot use a stop or a settled failed action as approval', () => {
    const { owner, material } = fixture(),
      review = owner.startProposal('a', material),
      action = owner.begin('a', target())
    owner.stop('a')
    owner.finishFailed('a', action)
    expect(() =>
      owner.recordDecision('a', {
        decision: 'approve',
        reviewIdentity: review.identity,
        acceptedExceptions: []
      })
    ).toThrow()
    expect(owner.snapshot('a').reviewState).toBe('blocked')
  })
  it('stops and invalidates before dispose returns', () => {
    const { owner, material } = fixture(),
      action = owner.begin('a', target())
    owner.startProposal('a', material)
    owner.dispose('a')
    expect(action.signal.aborted).toBe(true)
    expect(owner.snapshot('a').reviewState).toBe('blocked')
  })
  it('cannot let a review-material getter invalidate then resume the review', () => {
    const { owner, material } = fixture()
    const bad = {
      ...material,
      get sessionId(): string {
        owner.stop('a')
        return material.sessionId
      }
    }
    expect(() => owner.startProposal('a', bad)).toThrow()
    expect(owner.snapshot('a').coordinator.session.phase).toBe('paused')
  })
  it('does not allow another tab action to be settled under the wrong tab', () => {
    const { owner, registry } = fixture(),
      b = new Contents(2)
    registry.register('b', b.wc())
    owner.register(registry, target('b'))
    owner.grant('b', target('b'))
    const action = owner.begin('b', target('b'))
    expect(() => owner.finishFailed('a', action)).toThrow()
    expect(owner.snapshot('b').coordinator.session.phase).toBe('busy')
  })
  it('allows explicit resume after a settled undispatched stop without reviving prior review', () => {
    const { owner, material } = fixture()
    const prior = owner.startProposal('a', material),
      action = owner.begin('a', target())
    owner.stop('a')
    owner.finishFailed('a', action)
    expect(owner.snapshot('a').reviewState).toBe('blocked')
    owner.resume('a', target())
    const fresh = owner.startProposal('a', material)
    expect(fresh.reviewId).not.toBe(prior.reviewId)
  })
  it('requires actual settlement and reconciliation before resuming dispatched work', () => {
    const { owner, material } = fixture(),
      action = owner.begin('a', target())
    owner.startProposal('a', material)
    owner.markSideEffectStarting('a', action, target())
    owner.stop('a')
    expect(() => owner.acknowledgeUncertainty('a', target())).toThrow()
    owner.finishFailed('a', action)
    expect(() => owner.resume('a', target())).toThrow()
    owner.acknowledgeUncertainty('a', target())
    owner.resume('a', target())
    expect(owner.snapshot('a').coordinator.session.phase).toBe('ready')
    expect(owner.snapshot('a').reviewState).toBe('blocked')
  })
  it('never allows resume after navigation invalidates the bound view', () => {
    const { owner, contents } = fixture()
    contents.emit('did-start-navigation', { isMainFrame: true })
    expect(() => owner.resume('a', target())).toThrow()
  })
  it('does not invalidate a new review when an old action settles twice', () => {
    const { owner, material } = fixture(),
      action = owner.begin('a', target())
    owner.markSideEffectStarting('a', action, target())
    owner.complete('a', action, target())
    owner.startProposal('a', material)
    expect(() => owner.finishFailed('a', action)).toThrow('Stale')
    expect(owner.snapshot('a').reviewState).toBe('proposal-review')
  })
  it('invalidates review when target mismatch pauses the action, even if later resumed', () => {
    const { owner, material } = fixture(),
      action = owner.begin('a', target())
    const old = owner.startProposal('a', material)
    expect(() =>
      owner.markSideEffectStarting('a', action, { ...target(), conversationId: 'wrong' })
    ).toThrow()
    expect(owner.snapshot('a').reviewState).toBe('blocked')
    owner.finishFailed('a', action)
    owner.resume('a', target())
    expect(() =>
      owner.recordDecision('a', {
        decision: 'approve',
        reviewIdentity: old.identity,
        acceptedExceptions: []
      })
    ).toThrow()
    expect(owner.snapshot('a').reviewState).toBe('blocked')
  })
  it('retires an idle tab and reconnects only as a fresh, ungranted session', () => {
    const { owner, registry, material } = fixture()
    owner.startProposal('a', material)
    owner.retire('a')
    expect(() => owner.snapshot('a')).toThrow('Unknown')
    const fresh = owner.register(registry, target())
    expect(fresh.bindingId).not.toBe(material.targetBindingId)
    expect(fresh.session.session.phase).toBe('awaiting-consent')
    expect(fresh.session.session.sessionId).not.toBe(material.sessionId)
    expect(() => owner.begin('a', target())).toThrow()
  })
  it('does not retire until running work actually settles', () => {
    const { owner } = fixture(),
      action = owner.begin('a', target())
    expect(() => owner.retire('a')).toThrow('unresolved')
    owner.stop('a')
    expect(() => owner.retire('a')).toThrow('unresolved')
    owner.finishFailed('a', action)
    owner.retire('a')
    expect(() => owner.snapshot('a')).toThrow()
  })
  it('requires independent reconciliation of a dispatched action after view invalidation', () => {
    const { owner, registry, contents } = fixture(),
      action = owner.begin('a', target())
    owner.markSideEffectStarting('a', action, target())
    contents.emit('did-start-navigation', { isMainFrame: true })
    expect(() => owner.reconcileForRetirement('a', target())).toThrow()
    owner.finishFailed('a', action)
    expect(() => owner.retire('a')).toThrow('unresolved')
    expect(() => owner.reconcileForRetirement('a', { ...target(), projectId: 'wrong' })).toThrow()
    owner.reconcileForRetirement('a', target())
    expect(() => owner.resume('a', target())).toThrow()
    owner.retire('a')
    expect(owner.register(registry, target()).session.session.phase).toBe('awaiting-consent')
  })
  it('reuses bounded owner capacity across many settled tab lifecycles', () => {
    const { owner, registry, contents } = fixture()
    owner.retire('a')
    for (let i = 0; i < 300; i++) {
      const id = `tab-${i}`
      registry.register(id, new Contents(i + 2).wc())
      const registration = owner.register(registry, target(id))
      expect(registration.session.session.phase).toBe('awaiting-consent')
      owner.retire(id)
      // Caller owns registry teardown separately; retain no references here.
      registry.forget(id)
    }
    expect(contents.listenerCount('did-start-navigation')).toBe(1)
  })
  it('can reconcile revoked uncertain work solely for retirement without restoring consent', () => {
    const { owner, registry } = fixture(),
      action = owner.begin('a', target())
    owner.markSideEffectStarting('a', action, target())
    owner.revoke('a')
    expect(() => owner.reconcileRevokedForRetirement('a', target())).toThrow()
    owner.finishFailed('a', action)
    expect(() => owner.retire('a')).toThrow()
    expect(() =>
      owner.reconcileRevokedForRetirement('a', { ...target(), projectId: 'wrong' })
    ).toThrow()
    owner.reconcileRevokedForRetirement('a', target())
    expect(() => owner.resume('a', target())).toThrow()
    owner.retire('a')
    expect(owner.register(registry, target()).session.session.phase).toBe('awaiting-consent')
  })
})
