import { EventEmitter } from 'node:events'
import type { WebContents } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import { AgentBridgeCoordinator } from './agentBridgeCoordinator'
import type { BridgeTarget } from './agentBridgeSession'
import { ArenaViewRegistry } from './arenaViewRegistry'
import { acquireArenaViewLease } from './arenaViewLease'
import { ArenaBridgeViewBinding } from './arenaBridgeViewBinding'

class FakeContents extends EventEmitter {
  constructor(public id: number) {
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
    conversationId: 'chat',
    navigationEpoch: 'nav',
    agentSessionId: 'agent',
    projectId: 'project',
    worktreeId: 'tree'
  }
}
function fixture(): {
  registry: ArenaViewRegistry
  contents: FakeContents
  coordinator: AgentBridgeCoordinator
  binding: ArenaBridgeViewBinding
} {
  const registry = new ArenaViewRegistry(),
    contents = new FakeContents(1)
  registry.register('a', contents.wc())
  const coordinator = new AgentBridgeCoordinator()
  coordinator.register(target())
  coordinator.grant('a', target())
  return {
    registry,
    contents,
    coordinator,
    binding: new ArenaBridgeViewBinding(coordinator, acquireArenaViewLease(registry, 'a'))
  }
}

describe('unwired view-to-action binding', () => {
  it('stops dispatched work as uncertain when navigation begins', () => {
    const { binding, contents, coordinator } = fixture(),
      action = binding.begin(target())
    binding.markSideEffectStarting(action, target())
    contents.emit('did-start-navigation', { isMainFrame: true })
    expect(action.signal.aborted).toBe(true)
    expect(coordinator.snapshot('a').session.phase).toBe('uncertain')
    expect(() => binding.complete(action, target())).toThrow()
  })
  it('detects replacement at the next boundary and refuses to mark dispatch', () => {
    const { binding, registry, coordinator } = fixture(),
      action = binding.begin(target())
    registry.register('a', new FakeContents(2).wc())
    expect(() => binding.markSideEffectStarting(action, target())).toThrow()
    expect(action.signal.aborted).toBe(true)
    expect(coordinator.snapshot('a').session.phase).toBe('paused')
    expect(coordinator.snapshot('a').session.requestPhase).toBeNull()
  })
  it('stops before disposal and never reuses the binding', () => {
    const { binding, coordinator } = fixture(),
      action = binding.begin(target())
    binding.dispose()
    binding.dispose()
    expect(action.signal.aborted).toBe(true)
    expect(coordinator.snapshot('a').session.phase).toBe('paused')
    expect(() => binding.begin(target())).toThrow()
  })
  it('rejects a wrong tab and stops the current tab, without touching another tab', () => {
    const { binding, coordinator } = fixture(),
      action = binding.begin(target())
    expect(() => binding.markSideEffectStarting(action, target('other'))).toThrow()
    expect(action.signal.aborted).toBe(true)
    expect(coordinator.snapshot('a').session.phase).toBe('paused')
  })
  it('checks lease again after a target proxy triggers navigation', () => {
    const { binding, contents, coordinator } = fixture(),
      action = binding.begin(target())
    const proxy = new Proxy(target(), {
      getOwnPropertyDescriptor(object, key) {
        contents.emit('did-start-navigation', { isMainFrame: true })
        return Reflect.getOwnPropertyDescriptor(object, key)
      }
    })
    expect(() => binding.markSideEffectStarting(action, proxy)).toThrow()
    expect(coordinator.snapshot('a').session.phase).toBe('paused')
    expect(action.signal.aborted).toBe(true)
  })
  it('does not use a forged action handle or accept a handle from another binding', () => {
    const { binding, coordinator } = fixture(),
      action = binding.begin(target())
    expect(() => binding.markSideEffectStarting({ ...action }, target())).toThrow()
    expect(coordinator.snapshot('a').session.requestPhase).toBe('prepared')
  })
  it('does not create a binding for a view already invalidated', () => {
    const registry = new ArenaViewRegistry(),
      contents = new FakeContents(1)
    registry.register('a', contents.wc())
    const coordinator = new AgentBridgeCoordinator()
    coordinator.register(target())
    coordinator.grant('a', target())
    const lease = acquireArenaViewLease(registry, 'a')
    lease.dispose()
    expect(() => new ArenaBridgeViewBinding(coordinator, lease)).toThrow()
    expect(coordinator.snapshot('a').session.phase).toBe('paused')
  })
  it('reports a cooperative stop failure without claiming the action was cancelled', () => {
    const { binding, coordinator, contents } = fixture()
    const action = binding.begin(target())
    vi.spyOn(coordinator, 'stop').mockImplementation(() => {
      throw new Error('private')
    })
    contents.emit('did-start-navigation', { isMainFrame: true })
    expect(binding.status()).toEqual({ closed: true, stopFailed: true })
    expect(action.signal.aborted).toBe(false)
    expect(() => binding.markSideEffectStarting(action, target())).toThrow()
    expect(JSON.stringify(binding.status())).not.toContain('private')
  })
  it('settles an undispatched reservation if the view changes before begin returns', () => {
    const { binding, coordinator, registry } = fixture()
    const begin = coordinator.begin.bind(coordinator)
    vi.spyOn(coordinator, 'begin').mockImplementation((tab, observed) => {
      const action = begin(tab, observed)
      registry.invalidate(tab)
      return action
    })
    expect(() => binding.begin(target())).toThrow()
    expect(coordinator.snapshot('a').session.phase).toBe('paused')
    expect(coordinator.snapshot('a').gate.running).toBe(false)
  })
})
