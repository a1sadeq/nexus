import { describe, expect, it } from 'vitest'
import { AgentBridgeSessions, type BridgeTarget } from './agentBridgeSession'
import { watchArenaConsultation, type ProviderCondition } from './arenaConsultationWatch'
import type { ReplySnapshot, ObservedTurn } from './arenaReplyCandidate'

const hash = (x: string): string => x.repeat(64)
const turn = (id: string, role: 'user' | 'other', hashChar: string): ObservedTurn => ({
  id,
  role,
  digest: hash(hashChar)
})
const target = (): BridgeTarget => ({
  tabId: 'tab',
  providerId: 'arena',
  conversationId: 'conversation',
  navigationEpoch: 'nav',
  agentSessionId: 'agent',
  projectId: 'project',
  worktreeId: 'tree'
})
const baseline = (): ReplySnapshot => ({
  binding: 'conversation',
  navigationEpoch: 'nav',
  grantRevision: 1,
  control: 'ready-to-send',
  turns: [turn('old', 'other', 'a')]
})
const snapshot = (control: ReplySnapshot['control'], response = false): ReplySnapshot => ({
  ...baseline(),
  control,
  turns: [
    ...baseline().turns,
    turn('user', 'user', 'b'),
    ...(response ? [turn('reply', 'other', 'c')] : [])
  ]
})
function setup(): {
  sessions: AgentBridgeSessions
  lease: ReturnType<AgentBridgeSessions['begin']>
  watch: ReturnType<typeof watchArenaConsultation>
} {
  const sessions = new AgentBridgeSessions()
  const id = sessions.create(target()).sessionId
  sessions.grant(id, target())
  const lease = sessions.begin(id, target())
  sessions.markDispatchStarting(lease, target())
  const watch = watchArenaConsultation(sessions, lease, target(), baseline(), hash('b'), 0, 10000)
  return { sessions, lease, watch }
}

describe('Arena consultation watch', () => {
  it('keeps the lease busy even after a stable candidate', () => {
    const { sessions, lease, watch } = setup()
    expect(watch.observe(snapshot('generating'), target(), 'clear', 0)).toEqual({
      state: 'waiting'
    })
    expect(watch.observe(snapshot('send-disabled', true), target(), 'clear', 1)).toEqual({
      state: 'waiting'
    })
    expect(watch.observe(snapshot('send-disabled', true), target(), 'clear', 1501)).toEqual({
      state: 'candidate',
      responseDigest: hash('c')
    })
    expect(sessions.snapshot(lease.sessionId).phase).toBe('busy')
    expect(sessions.snapshot(lease.sessionId).requestPhase).toBe('dispatched')
  })
  it.each(['captcha', 'login', 'error', 'unknown'] as ProviderCondition[])(
    'pauses on provider condition %s with uncertain delivery',
    (condition) => {
      const { sessions, lease, watch } = setup()
      expect(watch.observe(snapshot('generating'), target(), condition, 1)).toEqual({
        state: 'paused',
        reason: 'provider-blocked'
      })
      expect(sessions.snapshot(lease.sessionId).phase).toBe('uncertain')
      expect(watch.observe(snapshot('generating'), target(), 'clear', 2)).toEqual({
        state: 'paused',
        reason: 'provider-blocked'
      })
    }
  )
  it('pauses after a deadline only when polled', () => {
    const { sessions, lease, watch } = setup()
    expect(watch.observe(snapshot('generating'), target(), 'clear', 10000)).toEqual({
      state: 'paused',
      reason: 'deadline'
    })
    expect(sessions.snapshot(lease.sessionId).phase).toBe('uncertain')
  })
  it('pauses on inconsistent evidence', () => {
    const { sessions, lease, watch } = setup()
    expect(watch.observe(snapshot('send-disabled', true), target(), 'clear', 10)).toEqual({
      state: 'paused',
      reason: 'evidence-ambiguous'
    })
    expect(sessions.snapshot(lease.sessionId).phase).toBe('uncertain')
  })
  it('handles manual stop as uncertain, not a completed action', () => {
    const { sessions, lease, watch } = setup()
    expect(watch.stop(target())).toEqual({ state: 'paused', reason: 'stopped' })
    expect(sessions.snapshot(lease.sessionId).phase).toBe('uncertain')
  })
  it('does not override revocation or stale leases', () => {
    const { sessions, lease, watch } = setup()
    sessions.revoke(lease.sessionId)
    expect(watch.observe(snapshot('generating'), target(), 'clear', 1)).toEqual({
      state: 'paused',
      reason: 'lease-invalid'
    })
    expect(sessions.snapshot(lease.sessionId).phase).toBe('revoked')
  })
  it('rejects changed target and cannot silently resume', () => {
    const { sessions, lease, watch } = setup()
    expect(
      watch.observe(snapshot('generating'), { ...target(), tabId: 'other' }, 'clear', 1)
    ).toEqual({ state: 'paused', reason: 'lease-invalid' })
    expect(sessions.snapshot(lease.sessionId).phase).toBe('uncertain')
  })
  it('rejects baseline mismatch after dispatch as uncertain', () => {
    const sessions = new AgentBridgeSessions(),
      id = sessions.create(target()).sessionId
    sessions.grant(id, target())
    const lease = sessions.begin(id, target())
    sessions.markDispatchStarting(lease, target())
    expect(() =>
      watchArenaConsultation(
        sessions,
        lease,
        target(),
        { ...baseline(), binding: 'other' },
        hash('b'),
        0,
        10000
      )
    ).toThrow(/baseline/)
    expect(sessions.snapshot(id).phase).toBe('uncertain')
  })
  it('cannot attach to a prepared but undispatched request', () => {
    const sessions = new AgentBridgeSessions(),
      id = sessions.create(target()).sessionId
    sessions.grant(id, target())
    const lease = sessions.begin(id, target())
    expect(() =>
      watchArenaConsultation(sessions, lease, target(), baseline(), hash('b'), 0, 10000)
    ).toThrow(/not marked/)
  })
  it('invalidates a candidate when a challenge appears', () => {
    const { sessions, lease, watch } = setup()
    watch.observe(snapshot('generating'), target(), 'clear', 0)
    watch.observe(snapshot('send-disabled', true), target(), 'clear', 1)
    expect(watch.observe(snapshot('send-disabled', true), target(), 'clear', 1501).state).toBe(
      'candidate'
    )
    expect(watch.observe(snapshot('send-disabled', true), target(), 'captcha', 1502)).toEqual({
      state: 'paused',
      reason: 'provider-blocked'
    })
    expect(sessions.snapshot(lease.sessionId).phase).toBe('uncertain')
  })
  it('pauses on a backward clock and malformed observation', () => {
    const a = setup()
    a.watch.observe(snapshot('generating'), target(), 'clear', 10)
    expect(a.watch.observe(snapshot('generating'), target(), 'clear', 9)).toEqual({
      state: 'paused',
      reason: 'evidence-ambiguous'
    })
    const b = setup()
    expect(b.watch.observe(null, target(), 'clear', 1)).toEqual({
      state: 'paused',
      reason: 'evidence-ambiguous'
    })
  })
  it('marks dispatched work uncertain when baseline access throws during setup', () => {
    const sessions = new AgentBridgeSessions(),
      id = sessions.create(target()).sessionId
    sessions.grant(id, target())
    const lease = sessions.begin(id, target())
    sessions.markDispatchStarting(lease, target())
    const bad = {
      ...baseline(),
      get binding(): string {
        throw new Error('sensitive page data')
      }
    }
    expect(() =>
      watchArenaConsultation(sessions, lease, target(), bad, hash('b'), 0, 10000)
    ).toThrow('Invalid consultation baseline or deadline')
    expect(sessions.snapshot(id).phase).toBe('uncertain')
  })
  it('pauses uncertain and hides exception details when evidence access throws', () => {
    const { sessions, lease, watch } = setup()
    const bad = {
      ...snapshot('generating'),
      get turns(): ObservedTurn[] {
        throw new Error('private page data')
      }
    }
    const result = watch.observe(bad, target(), 'clear', 1)
    expect(result).toEqual({ state: 'paused', reason: 'evidence-ambiguous' })
    expect(JSON.stringify(result)).not.toContain('private')
    expect(sessions.snapshot(lease.sessionId).phase).toBe('uncertain')
  })
  it('does not pause a replacement request if an evidence getter changes the lease then throws', () => {
    const { sessions, lease, watch } = setup()
    let newLease: ReturnType<AgentBridgeSessions['begin']> | undefined
    const bad = {
      ...snapshot('generating'),
      get turns(): ObservedTurn[] {
        sessions.resolve(lease, target())
        newLease = sessions.begin(lease.sessionId, target())
        throw new Error('private')
      }
    }
    expect(watch.observe(bad, target(), 'clear', 1)).toEqual({
      state: 'paused',
      reason: 'lease-invalid'
    })
    expect(sessions.snapshot(lease.sessionId)).toMatchObject({
      phase: 'busy',
      requestPhase: 'prepared'
    })
    sessions.assertLease(newLease!, target())
  })
  it('rejects a result if a reentrant evidence getter invalidates the lease without throwing', () => {
    const { sessions, lease, watch } = setup()
    const value = snapshot('generating')
    const bad = {
      ...value,
      get turns(): ObservedTurn[] {
        sessions.revoke(lease.sessionId)
        return value.turns
      }
    }
    expect(watch.observe(bad, target(), 'clear', 1)).toEqual({
      state: 'paused',
      reason: 'lease-invalid'
    })
    expect(sessions.snapshot(lease.sessionId).phase).toBe('revoked')
  })
  it('does not override revocation if initialization evidence invalidates its lease', () => {
    const sessions = new AgentBridgeSessions(),
      id = sessions.create(target()).sessionId
    sessions.grant(id, target())
    const lease = sessions.begin(id, target())
    sessions.markDispatchStarting(lease, target())
    const bad = {
      ...baseline(),
      get binding(): string {
        sessions.revoke(id)
        throw new Error('private')
      }
    }
    expect(() =>
      watchArenaConsultation(sessions, lease, target(), bad, hash('b'), 0, 10000)
    ).toThrow()
    expect(sessions.snapshot(id).phase).toBe('revoked')
  })
  it('does not create a watch if setup evidence revokes its lease without throwing', () => {
    const sessions = new AgentBridgeSessions(),
      id = sessions.create(target()).sessionId
    sessions.grant(id, target())
    const lease = sessions.begin(id, target())
    sessions.markDispatchStarting(lease, target())
    const value = baseline()
    const bad = {
      ...value,
      get turns(): ObservedTurn[] {
        sessions.revoke(id)
        return value.turns
      }
    }
    expect(() =>
      watchArenaConsultation(sessions, lease, target(), bad, hash('b'), 0, 10000)
    ).toThrow()
    expect(sessions.snapshot(id).phase).toBe('revoked')
  })
})
