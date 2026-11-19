import { describe, expect, it } from 'vitest'
import { AgentBridgeCoordinator } from './agentBridgeCoordinator'
import type { BridgeTarget } from './agentBridgeSession'

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
function setup(): AgentBridgeCoordinator {
  const c = new AgentBridgeCoordinator()
  c.register(target())
  c.grant('a', target())
  return c
}

describe('unwired bridge coordination', () => {
  it('requires consent and marks both layers before a trusted completion', () => {
    const c = new AgentBridgeCoordinator()
    c.register(target())
    expect(() => c.begin('a', target())).toThrow()
    // A failed begin pauses the cooperative gate; reset it before granting.
    c.resume('a', target())
    c.grant('a', target())
    const a = c.begin('a', target())
    expect(() => c.complete(a, target())).toThrow(/not marked/)
    c.markSideEffectStarting(a, target())
    expect(c.snapshot('a').session.requestPhase).toBe('dispatched')
    expect(() => c.markSideEffectStarting(a, target())).toThrow(/already/)
    const result = c.complete(a, target())
    expect(result.session.phase).toBe('ready')
    expect(result.gate.state).toBe('ready')
    expect(() => c.complete(a, target())).toThrow(/Stale/)
  })
  it('rejects changed targets and stops the matching action', () => {
    const c = setup(),
      a = c.begin('a', target())
    expect(() => c.assertActive(a, { ...target(), conversationId: 'other' })).toThrow()
    expect(a.signal.aborted).toBe(true)
    expect(c.snapshot('a').session.phase).toBe('paused')
    c.finishFailed(a)
    expect(() => c.resume('a', { ...target(), conversationId: 'other' })).toThrow()
    c.resume('a', target())
    expect(c.snapshot('a').session.phase).toBe('ready')
  })
  it('marks interrupted dispatched actions uncertain in both layers until settlement and reconciliation', () => {
    const c = setup(),
      a = c.begin('a', target())
    c.markSideEffectStarting(a, target())
    c.stop('a')
    expect(a.signal.aborted).toBe(true)
    expect(c.snapshot('a').session.phase).toBe('uncertain')
    expect(c.snapshot('a').gate.state).toBe('uncertain')
    expect(() => c.acknowledgeUncertainty('a', target())).toThrow(/not settled/)
    c.finishFailed(a)
    expect(() => c.resume('a', target())).toThrow()
    c.acknowledgeUncertainty('a', target())
    expect(c.snapshot('a').session.phase).toBe('paused')
    expect(c.snapshot('a').gate.state).toBe('paused')
    c.resume('a', target())
    expect(c.snapshot('a').session.phase).toBe('ready')
  })
  it('leaves interrupted pre-dispatch work paused without uncertainty', () => {
    const c = setup(),
      a = c.begin('a', target())
    c.stop('a')
    c.finishFailed(a)
    expect(c.snapshot('a').session.phase).toBe('paused')
    expect(c.snapshot('a').gate.state).toBe('paused')
    expect(() => c.acknowledgeUncertainty('a', target())).toThrow(/No uncertainty/)
  })
  it('blocks all tabs before abort handlers run and keeps all paused after release', () => {
    const c = setup()
    c.register(target('b'))
    c.grant('b', target('b'))
    const a = c.begin('a', target()),
      b = c.begin('b', target('b'))
    a.signal.addEventListener('abort', () => {
      expect(() => c.register(target('c'))).toThrow()
      expect(() => c.releaseStopAll()).toThrow()
      expect(c.snapshot('b').session.phase).toBe('paused')
    })
    c.stopAll()
    expect(b.signal.aborted).toBe(true)
    c.finishFailed(a)
    c.finishFailed(b)
    c.releaseStopAll()
    expect(() => c.begin('a', target())).toThrow()
    c.resume('a', target())
    expect(c.begin('a', target()).signal.aborted).toBe(false)
    expect(c.snapshot('b').session.phase).toBe('paused')
  })
  it('does not let stale or forged handles finish another action', () => {
    const c = setup(),
      a = c.begin('a', target())
    c.markSideEffectStarting(a, target())
    c.complete(a, target())
    const b = c.begin('a', target())
    expect(() => c.finishFailed(a)).toThrow(/Stale/)
    expect(() => c.finishFailed({ ...b, signal: new AbortController().signal })).toThrow(/Stale/)
    expect(c.snapshot('a').session.phase).toBe('busy')
  })
  it('rejects duplicate registrations and rolls back gate registration after an invalid target', () => {
    const c = new AgentBridgeCoordinator()
    expect(() => c.register({ ...target(), projectId: '' })).toThrow()
    c.register(target())
    expect(() => c.register(target())).toThrow()
  })
  it('failed actions stay paused, and dispatched failures remain uncertain', () => {
    const c = setup(),
      a = c.begin('a', target())
    c.markSideEffectStarting(a, target())
    c.finishFailed(a)
    expect(c.snapshot('a').session.phase).toBe('uncertain')
    expect(c.snapshot('a').gate.state).toBe('uncertain')
  })
  it('does not acknowledge uncertainty against a different target', () => {
    const c = setup(),
      a = c.begin('a', target())
    c.markSideEffectStarting(a, target())
    c.finishFailed(a)
    expect(() => c.acknowledgeUncertainty('a', { ...target(), projectId: 'wrong' })).toThrow()
    expect(c.snapshot('a').session.phase).toBe('uncertain')
    expect(c.snapshot('a').gate.state).toBe('uncertain')
  })
  it('revokes the session before signaling the adapter and never silently resumes', () => {
    const c = setup(),
      a = c.begin('a', target())
    c.markSideEffectStarting(a, target())
    a.signal.addEventListener('abort', () => expect(c.snapshot('a').session.phase).toBe('revoked'))
    expect(c.revoke('a').session.phase).toBe('revoked')
    c.finishFailed(a)
    expect(() => c.resume('a', target())).toThrow()
    expect(() => c.grant('a', target())).toThrow()
    expect(c.snapshot('a').gate.state).toBe('uncertain')
  })
  it('propagates a blocked provider observation to both state machines and abort signal', () => {
    const c = setup(),
      action = c.begin('a', target())
    c.markSideEffectStarting(action, target())
    const baseline = {
      binding: 'chat-a',
      navigationEpoch: 'nav',
      grantRevision: 1,
      control: 'ready-to-send' as const,
      turns: []
    }
    const watch = c.openWatch(action, target(), baseline, 'a'.repeat(64), 0, 10000)
    expect(() => c.openWatch(action, target(), baseline, 'a'.repeat(64), 0, 10000)).toThrow()
    expect(watch.observe(null, target(), 'captcha', 1)).toEqual({
      state: 'paused',
      reason: 'provider-blocked'
    })
    expect(action.signal.aborted).toBe(true)
    expect(c.snapshot('a').session.phase).toBe('uncertain')
    expect(c.snapshot('a').gate.state).toBe('uncertain')
  })
  it('stops and marks dispatch uncertain if a watch cannot initialize', () => {
    const c = setup(),
      action = c.begin('a', target())
    c.markSideEffectStarting(action, target())
    const bad = {
      binding: 'wrong',
      navigationEpoch: 'nav',
      grantRevision: 1,
      control: 'ready-to-send' as const,
      turns: []
    }
    expect(() => c.openWatch(action, target(), bad, 'a'.repeat(64), 0, 10000)).toThrow()
    expect(action.signal.aborted).toBe(true)
    expect(c.snapshot('a').session.phase).toBe('uncertain')
    expect(c.snapshot('a').gate.state).toBe('uncertain')
  })
  it('never promotes a stable candidate to completion or approval', () => {
    const c = setup(),
      action = c.begin('a', target())
    c.markSideEffectStarting(action, target())
    const baseline = {
      binding: 'chat-a',
      navigationEpoch: 'nav',
      grantRevision: 1,
      control: 'ready-to-send' as const,
      turns: []
    }
    const watch = c.openWatch(action, target(), baseline, 'a'.repeat(64), 0, 10000)
    const user = { id: 'u', role: 'user' as const, digest: 'a'.repeat(64) }
    const other = { id: 'r', role: 'other' as const, digest: 'b'.repeat(64) }
    expect(
      watch.observe({ ...baseline, control: 'generating', turns: [user] }, target(), 'clear', 1)
        .state
    ).toBe('waiting')
    const response = { ...baseline, control: 'send-disabled', turns: [user, other] }
    expect(watch.observe(response, target(), 'clear', 2).state).toBe('waiting')
    expect(watch.observe(response, target(), 'clear', 1502).state).toBe('candidate')
    expect(c.snapshot('a').session.phase).toBe('busy')
    expect(c.snapshot('a').gate.state).toBe('running')
  })
  it('cannot resume reentrantly from an abort listener that settles the action', () => {
    const c = setup(),
      action = c.begin('a', target())
    let called = false
    action.signal.addEventListener('abort', () => {
      called = true
      c.finishFailed(action)
      expect(() => c.resume('a', target())).toThrow('Resume blocked')
    })
    c.stop('a')
    expect(called).toBe(true)
    expect(c.snapshot('a').session.phase).toBe('paused')
    expect(c.snapshot('a').gate.state).toBe('paused')
    c.resume('a', target())
  })
  it('rejects an accessor target and stops active work without invoking its getter', () => {
    const c = setup(),
      action = c.begin('a', target())
    let called = false
    const bad = {
      ...target(),
      get projectId(): string {
        called = true
        throw new Error('private')
      }
    }
    expect(() => c.assertActive(action, bad)).toThrow()
    expect(called).toBe(false)
    expect(action.signal.aborted).toBe(true)
    expect(c.snapshot('a').session.phase).toBe('paused')
  })
  it('does not start after a target proxy triggers Stop All during copying', () => {
    const c = setup()
    let stopped = false
    const observed = new Proxy(target(), {
      getOwnPropertyDescriptor(object, key) {
        if (!stopped) {
          stopped = true
          c.stopAll()
        }
        return Reflect.getOwnPropertyDescriptor(object, key)
      }
    })
    expect(() => c.begin('a', observed)).toThrow()
    expect(c.snapshot('a').session.phase).toBe('paused')
    expect(c.snapshot('a').gate.stopAllLatched).toBe(true)
  })
  it('does not stop a replacement action after a target proxy reenters during a check', () => {
    const c = setup(),
      original = c.begin('a', target())
    c.markSideEffectStarting(original, target())
    let next: ReturnType<AgentBridgeCoordinator['begin']> | undefined
    let called = false
    const observed = new Proxy(target(), {
      getOwnPropertyDescriptor(object, key) {
        if (!called) {
          called = true
          c.complete(original, target())
          next = c.begin('a', target())
        }
        return Reflect.getOwnPropertyDescriptor(object, key)
      }
    })
    expect(() => c.assertActive(original, observed)).toThrow()
    expect(next?.signal.aborted).toBe(false)
    expect(c.snapshot('a').session.phase).toBe('busy')
  })
  it('retires settled tabs and requires fresh consent when reusing the ID', () => {
    const c = setup(),
      old = c.snapshot('a').session.sessionId
    c.retire('a')
    expect(() => c.snapshot('a')).toThrow('Unknown')
    c.register(target())
    expect(c.snapshot('a').session.sessionId).not.toBe(old)
    expect(c.snapshot('a').session.phase).toBe('awaiting-consent')
  })
  it('never retires a running or uncertain action', () => {
    const c = setup(),
      a = c.begin('a', target())
    expect(() => c.retire('a')).toThrow()
    c.markSideEffectStarting(a, target())
    c.finishFailed(a)
    expect(() => c.retire('a')).toThrow()
    c.acknowledgeUncertainty('a', target())
    c.retire('a')
    expect(() => c.snapshot('a')).toThrow()
  })
  it('rejects retirement during abort listener signaling even after synchronous settlement', () => {
    const c = setup(),
      a = c.begin('a', target())
    a.signal.addEventListener('abort', () => {
      c.finishFailed(a)
      expect(() => c.retire('a')).toThrow('unresolved')
    })
    c.stop('a')
    expect(c.snapshot('a').session.phase).toBe('paused')
    c.retire('a')
  })
})
