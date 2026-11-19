import { describe, expect, it } from 'vitest'
import { AgentBridgeSessions, type BridgeTarget } from './agentBridgeSession'

const target = (): BridgeTarget => ({
  tabId: 'tab-1',
  providerId: 'arena',
  conversationId: 'conversation-1',
  navigationEpoch: 'nav-1',
  agentSessionId: 'agent-1',
  projectId: 'project-1',
  worktreeId: 'tree-1'
})

function ready(): {
  broker: AgentBridgeSessions
  binding: BridgeTarget
  id: string
} {
  const broker = new AgentBridgeSessions()
  const binding = target()
  const id = broker.create(binding).sessionId
  broker.grant(id, binding)
  return { broker, binding, id }
}

describe('agent bridge session foundation', () => {
  it('starts without consent and never begins a request', () => {
    const broker = new AgentBridgeSessions()
    const id = broker.create(target()).sessionId
    expect(broker.snapshot(id).phase).toBe('awaiting-consent')
    expect(() => broker.begin(id, target())).toThrow(/not ready/)
  })
  it('rejects missing or empty target identities', () => {
    const broker = new AgentBridgeSessions()
    expect(() => broker.create({ ...target(), conversationId: ' ' })).toThrow(/identity/)
    expect(() => broker.create(null as never)).toThrow(/identity/)
  })
  it('copies binding so caller mutation cannot redirect a session', () => {
    const broker = new AgentBridgeSessions(),
      b = target()
    const id = broker.create(b).sessionId
    b.tabId = 'other'
    expect(() => broker.grant(id, b)).toThrow(/mismatch/)
    expect(broker.snapshot(id).phase).toBe('awaiting-consent')
    broker.grant(id, target())
    expect(broker.snapshot(id).phase).toBe('ready')
  })
  it.each([
    'tabId',
    'providerId',
    'conversationId',
    'navigationEpoch',
    'agentSessionId',
    'projectId',
    'worktreeId'
  ] as const)('invalidates an active request when %s changes', (key) => {
    const { broker, id, binding } = ready()
    const lease = broker.begin(id, binding)
    expect(() => broker.assertLease(lease, { ...binding, [key]: 'different' })).toThrow(/mismatch/)
    expect(broker.snapshot(id).phase).toBe('paused')
    expect(() => broker.assertLease(lease, binding)).toThrow(/invalid request lease/)
  })
  it('enforces one active request and rejects duplicate dispatch', () => {
    const { broker, id, binding } = ready()
    const lease = broker.begin(id, binding)
    expect(() => broker.begin(id, binding)).toThrow(/not ready/)
    broker.markDispatchStarting(lease, binding)
    expect(() => broker.markDispatchStarting(lease, binding)).toThrow(/already started/)
    broker.resolve(lease, binding)
    expect(broker.snapshot(id).phase).toBe('ready')
    expect(() => broker.resolve(lease, binding)).toThrow(/invalid request lease/)
  })
  it('never resolves a request that was not dispatched', () => {
    const { broker, id, binding } = ready()
    const lease = broker.begin(id, binding)
    expect(() => broker.resolve(lease, binding)).toThrow(/not started/)
  })
  it('pause blocks work and invalidates a prepared lease until user resume', () => {
    const { broker, id, binding } = ready()
    const lease = broker.begin(id, binding)
    expect(broker.pause(id).phase).toBe('paused')
    expect(() => broker.assertLease(lease, binding)).toThrow(/invalid request lease/)
    expect(() => broker.begin(id, binding)).toThrow(/not ready/)
    broker.resume(id, binding)
    expect(broker.begin(id, binding).requestId).not.toBe(lease.requestId)
  })
  it('dispatch interruption requires explicit reconciliation before resume', () => {
    const { broker, id, binding } = ready()
    const lease = broker.begin(id, binding)
    broker.markDispatchStarting(lease, binding)
    expect(broker.pause(id).phase).toBe('uncertain')
    expect(broker.pause(id).phase).toBe('uncertain')
    expect(() => broker.resume(id, binding)).toThrow(/cannot resume/)
    expect(() => broker.assertLease(lease, binding)).toThrow(/invalid request lease/)
    broker.acknowledgeUncertainty(id, binding)
    expect(broker.snapshot(id).phase).toBe('paused')
    broker.resume(id, binding)
    expect(broker.snapshot(id).phase).toBe('ready')
  })
  it('target mismatch during dispatch is uncertain and cannot silently resume', () => {
    const { broker, id, binding } = ready()
    const lease = broker.begin(id, binding)
    broker.markDispatchStarting(lease, binding)
    expect(() => broker.assertLease(lease, { ...binding, tabId: 'other' })).toThrow(/mismatch/)
    expect(broker.snapshot(id).phase).toBe('uncertain')
    expect(() => broker.resume(id, binding)).toThrow(/cannot resume/)
  })
  it('revocation is permanent for the in-memory session and invalidates leases', () => {
    const { broker, id, binding } = ready()
    const lease = broker.begin(id, binding)
    broker.revoke(id)
    expect(() => broker.assertLease(lease, binding)).toThrow(/invalid request lease/)
    expect(() => broker.grant(id, binding)).toThrow(/current state/)
    expect(() => broker.resume(id, binding)).toThrow(/cannot resume/)
    expect(() => broker.pause(id)).toThrow(/revoked/)
  })
  it('does not expose target or request content in snapshots', () => {
    const { broker, id, binding } = ready()
    broker.begin(id, binding)
    expect(Object.keys(broker.snapshot(id)).sort()).toEqual([
      'grantRevision',
      'phase',
      'requestPhase',
      'sessionId'
    ])
  })
  it('does not let a lease for one session operate on another', () => {
    const { broker, id, binding } = ready()
    const second = broker.create({ ...binding, tabId: 'tab-2' }).sessionId
    broker.grant(second, { ...binding, tabId: 'tab-2' })
    const a = broker.begin(id, binding)
    broker.begin(second, { ...binding, tabId: 'tab-2' })
    expect(() =>
      broker.assertLease({ ...a, sessionId: second }, { ...binding, tabId: 'tab-2' })
    ).toThrow(/invalid request lease/)
  })
  it('forgets only an explicitly revoked session', () => {
    const { broker, id } = ready()
    expect(() => broker.forgetRevoked(id)).toThrow()
    broker.revoke(id)
    broker.forgetRevoked(id)
    expect(() => broker.snapshot(id)).toThrow('Unknown session')
  })
  it('preserves revoked dispatch uncertainty until explicit independent reconciliation', () => {
    const { broker, id, binding } = ready()
    const lease = broker.begin(id, binding)
    broker.markDispatchStarting(lease, binding)
    broker.revoke(id)
    broker.revoke(id)
    expect(() => broker.forgetRevoked(id)).toThrow('unresolved')
    expect(() =>
      broker.acknowledgeRevokedUncertainty(id, { ...binding, projectId: 'wrong' })
    ).toThrow()
    expect(() => broker.forgetRevoked(id)).toThrow()
    broker.acknowledgeRevokedUncertainty(id, binding)
    expect(() => broker.resume(id, binding)).toThrow()
    broker.forgetRevoked(id)
  })
})
