import { describe, it, expect, beforeEach } from 'vitest'
import { AgentGrantStore, MAX_GRANT_TTL_MS, type AgentGrant } from './agentGrants'

const NOW = Date.parse('2026-11-19T10:00:00.000Z')

const scope = {
  clientId: 'client-1',
  agentSessionId: 'agent-1',
  projectId: 'proj-1',
  worktreeId: 'wt-1',
  conversationId: 'conv-1'
}

let clock = NOW
let store: AgentGrantStore

beforeEach(() => {
  clock = NOW
  store = new AgentGrantStore({ now: () => clock })
})

const issue = (overrides: Partial<Parameters<AgentGrantStore['issue']>[0]> = {}): AgentGrant =>
  store.issue({
    ...scope,
    actions: ['consult-arena', 'prepare-edit'],
    approvedPaths: ['/home/user/project'],
    ...overrides
  })

describe('issuing grants', () => {
  it('records the scope, the actions and a revision', () => {
    const grant = issue()
    expect(grant.grantId).toMatch(/^grant-/)
    expect(grant.revision).toBe(1)
    expect(grant.actions).toEqual(['consult-arena', 'prepare-edit'])
    expect(grant.autoSend).toBe(false)
    expect(grant.revokedAt).toBeNull()
  })

  it('never defaults auto-send on', () => {
    expect(issue().autoSend).toBe(false)
    expect(issue({ autoSend: true }).autoSend).toBe(true)
  })

  it('caps the lifetime instead of trusting the caller', () => {
    const grant = issue({ ttlMs: 999 * 60 * 60 * 1000 })
    expect(grant.expiresAt - grant.issuedAt).toBe(MAX_GRANT_TTL_MS)
  })

  it('refuses a grant with no actions or an unknown action', () => {
    expect(() => issue({ actions: [] })).toThrow(/at least one action/)
    expect(() => issue({ actions: ['become-admin' as never] })).toThrow(/Unknown action/)
  })

  it('refuses a scope with an empty field', () => {
    expect(() => issue({ projectId: '  ' })).toThrow(/projectId/)
  })

  it('keeps only absolute approved paths', () => {
    const grant = issue({ approvedPaths: ['/home/user/project', 'relative/path'] })
    expect(grant.approvedPaths).toEqual(['/home/user/project'])
  })
})

describe('checking grants', () => {
  it('allows an action the user granted', () => {
    const grant = issue()
    const check = store.check(grant.grantId, { action: 'consult-arena' })
    expect(check.allowed).toBe(true)
  })

  it('refuses an action that was not granted', () => {
    const grant = issue()
    const check = store.check(grant.grantId, { action: 'dispatch-message' })
    expect(check.allowed).toBe(false)
    if (!check.allowed) expect(check.code).toBe('action-not-granted')
  })

  it('refuses a different session, project, worktree or conversation', () => {
    const grant = issue()
    for (const override of [
      { agentSessionId: 'agent-2' },
      { projectId: 'proj-2' },
      { worktreeId: 'wt-2' },
      { conversationId: 'conv-2' }
    ]) {
      const check = store.check(grant.grantId, { action: 'consult-arena', ...override })
      expect(check.allowed).toBe(false)
      if (!check.allowed) expect(check.code).toBe('scope-mismatch')
    }
  })

  it('requires auto-send consent separately from the dispatch action', () => {
    const grant = issue({ actions: ['dispatch-message'] })
    const check = store.check(grant.grantId, { action: 'dispatch-message', needsAutoSend: true })
    expect(check.allowed).toBe(false)
    if (!check.allowed) expect(check.code).toBe('auto-send-not-granted')

    const approved = issue({ actions: ['dispatch-message'], autoSend: true })
    expect(store.check(approved.grantId, { action: 'dispatch-message', needsAutoSend: true }).allowed).toBe(true)
  })

  it('refuses a path outside the approved roots', () => {
    const grant = issue()
    const inside = store.check(grant.grantId, { action: 'prepare-edit', paths: ['/home/user/project/src/a.ts'] })
    expect(inside.allowed).toBe(true)
    const outside = store.check(grant.grantId, { action: 'prepare-edit', paths: ['/home/user/other/a.ts'] })
    expect(outside.allowed).toBe(false)
    if (!outside.allowed) expect(outside.code).toBe('path-not-granted')
  })

  it('refuses an unknown grant id', () => {
    const check = store.check('grant-nope', { action: 'consult-arena' })
    expect(check.allowed).toBe(false)
    if (!check.allowed) expect(check.code).toBe('unknown-grant')
  })

  it('refuses an expired grant even though the timestamp is untouched', () => {
    const grant = issue({ ttlMs: 1000 })
    clock = NOW + 2000
    const check = store.check(grant.grantId, { action: 'consult-arena' })
    expect(check.allowed).toBe(false)
    if (!check.allowed) expect(check.code).toBe('expired')
  })

  it('fails closed when the caller presents a stale revision', () => {
    const grant = issue()
    store.narrow(grant.grantId, { actions: ['consult-arena'] })
    const stale = store.check(grant.grantId, { action: 'consult-arena', expectedRevision: 1 })
    expect(stale.allowed).toBe(false)
    if (!stale.allowed) {
      expect(stale.code).toBe('revision-mismatch')
      expect(stale.message).toContain('re-read')
    }
  })
})

describe('revocation and narrowing', () => {
  it('revoking takes effect immediately for a caller holding the old object', () => {
    const grant = issue()
    const held: AgentGrant = { ...grant }
    expect(store.revoke(grant.grantId, 'user pressed Stop All')).toBe(true)
    const check = store.check(held.grantId, { action: 'consult-arena' })
    expect(check.allowed).toBe(false)
    if (!check.allowed) {
      expect(check.code).toBe('revoked')
      expect(check.message).toContain('Stop All')
    }
  })

  it('reports a second revoke as a no-op, not a success', () => {
    const grant = issue()
    expect(store.revoke(grant.grantId)).toBe(true)
    expect(store.revoke(grant.grantId)).toBe(false)
  })

  it('narrowing never widens: added actions stay refused', () => {
    const grant = issue({ actions: ['consult-arena', 'prepare-edit'] })
    const narrowed = store.narrow(grant.grantId, { actions: ['consult-arena'] })
    expect(narrowed?.actions).toEqual(['consult-arena'])
    expect(narrowed?.revision).toBe(2)
    expect(store.check(grant.grantId, { action: 'prepare-edit' }).allowed).toBe(false)
  })

  it('refuses to narrow a grant to nothing', () => {
    const grant = issue({ actions: ['consult-arena'] })
    expect(() => store.narrow(grant.grantId, { actions: [] })).toThrow(/no actions/)
  })

  it('cannot narrow a revoked grant', () => {
    const grant = issue()
    store.revoke(grant.grantId)
    expect(store.narrow(grant.grantId, { actions: ['consult-arena'] })).toBeNull()
  })
})

describe('persistence and sweeping', () => {
  it('persists without a client secret ever appearing', () => {
    let saved: AgentGrant[] = []
    const persisted = new AgentGrantStore({
      now: () => clock,
      persistence: { load: () => [], save: (grants) => (saved = grants) }
    })
    persisted.issue({ ...scope, actions: ['consult-arena'] })
    expect(saved).toHaveLength(1)
    const text = JSON.stringify(saved)
    expect(text).not.toMatch(/secret/i)
    expect(text).toContain('client-1')
  })

  it('restores persisted grants and ignores malformed records', () => {
    const record = {
      ...scope,
      grantId: 'grant-restored',
      actions: ['consult-arena'],
      approvedPaths: [],
      autoSend: false,
      revision: 3,
      issuedAt: NOW,
      expiresAt: NOW + 60_000,
      revokedAt: null,
      revocationReason: null
    }
    const restored = new AgentGrantStore({
      now: () => clock,
      persistence: { load: () => [record, { bad: true }, null], save: () => undefined }
    })
    expect(restored.list()).toHaveLength(1)
    expect(restored.check('grant-restored', { action: 'consult-arena' }).allowed).toBe(true)
  })

  it('sweeps expired grants into the audit trail', () => {
    const grant = issue({ ttlMs: 1000 })
    clock = NOW + 5000
    expect(store.sweepExpired()).toBe(1)
    const after = store.get(grant.grantId)
    expect(after?.revocationReason).toBe('expired')
    expect(store.check(grant.grantId, { action: 'consult-arena' }).allowed).toBe(false)
    expect(store.sweepExpired()).toBe(0)
  })

  it('prunes only old, finished grants', () => {
    const live = issue()
    const dead = issue({ ttlMs: 1000 })
    clock = NOW + 5000
    store.sweepExpired()
    expect(store.prune(60_000)).toBe(0)
    clock = NOW + 10 * 60_000
    expect(store.prune(60_000)).toBe(1)
    expect(store.get(live.grantId)).toBeTruthy()
    expect(store.get(dead.grantId)).toBeUndefined()
  })
})
