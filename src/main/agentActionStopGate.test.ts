import { describe, expect, it } from 'vitest'
import { AgentActionStopGate } from './agentActionStopGate'

function setup(): AgentActionStopGate {
  const gate = new AgentActionStopGate()
  gate.register('a')
  gate.register('b')
  return gate
}

describe('agent stop gate (unwired bookkeeping)', () => {
  it('serializes actions per tab while allowing independent tabs', () => {
    const gate = setup(),
      a = gate.begin('a'),
      b = gate.begin('b')
    expect(() => gate.begin('a')).toThrow('blocked')
    expect(gate.snapshot('b').state).toBe('running')
    expect(gate.finish(a, 'completed').state).toBe('ready')
    expect(gate.finish(b, 'completed').state).toBe('ready')
  })
  it('stop signals current action, blocks new work, and stays paused after it settles', () => {
    const gate = setup(),
      a = gate.begin('a')
    expect(gate.stop('a')).toEqual({ state: 'paused', running: true, stopAllLatched: false })
    expect(a.signal.aborted).toBe(true)
    expect(() => gate.assertActive(a)).toThrow('stopped')
    expect(() => gate.resume('a')).toThrow('Cannot resume')
    expect(gate.finish(a, 'completed').state).toBe('paused')
    expect(() => gate.begin('a')).toThrow('blocked')
    gate.resume('a')
    expect(gate.begin('a').signal.aborted).toBe(false)
  })
  it('stop after dispatch records uncertainty and requires settlement and reconciliation before resume', () => {
    const gate = setup(),
      a = gate.begin('a')
    gate.markSideEffectStarting(a)
    expect(gate.stop('a').state).toBe('uncertain')
    expect(() => gate.acknowledgeUncertainty('a')).toThrow()
    expect(gate.finish(a, 'completed').state).toBe('uncertain')
    expect(() => gate.resume('a')).toThrow()
    gate.acknowledgeUncertainty('a')
    expect(gate.snapshot('a').state).toBe('paused')
    gate.resume('a')
    expect(gate.snapshot('a').state).toBe('ready')
  })
  it('failure pauses even before dispatch and dispatched failure requires reconciliation', () => {
    const gate = setup(),
      a = gate.begin('a'),
      b = gate.begin('b')
    gate.markSideEffectStarting(b)
    expect(gate.finish(a, 'failed').state).toBe('paused')
    expect(gate.finish(b, 'failed').state).toBe('uncertain')
  })
  it('stop all blocks every tab before any synchronous abort listener runs', () => {
    const gate = setup(),
      a = gate.begin('a'),
      b = gate.begin('b')
    let seen = false
    a.signal.addEventListener('abort', () => {
      seen = true
      expect(() => gate.assertActive(b)).toThrow()
      expect(() => gate.register('c')).toThrow('Stop All')
      expect(() => gate.releaseStopAll()).toThrow('still signaling')
      expect(gate.snapshot('b').state).toBe('paused')
    })
    gate.stopAll()
    expect(seen).toBe(true)
    expect(b.signal.aborted).toBe(true)
    gate.finish(a, 'completed')
    gate.finish(b, 'completed')
    gate.releaseStopAll()
    expect(gate.snapshot('a').state).toBe('paused')
    expect(gate.snapshot('b').state).toBe('paused')
    expect(() => gate.begin('a')).toThrow()
  })
  it('does not make dispatched work certain merely by releasing Stop All', () => {
    const gate = setup(),
      a = gate.begin('a')
    gate.markSideEffectStarting(a)
    gate.stopAll()
    gate.releaseStopAll()
    gate.finish(a, 'completed')
    expect(gate.snapshot('a')).toEqual({
      state: 'uncertain',
      running: false,
      stopAllLatched: false
    })
    expect(() => gate.resume('a')).toThrow()
  })
  it('prevents stale and forged tickets from affecting newer actions', () => {
    const gate = setup(),
      a = gate.begin('a')
    gate.finish(a, 'completed')
    const next = gate.begin('a')
    expect(() => gate.finish(a, 'completed')).toThrow('Stale')
    expect(() => gate.assertActive({ ...next, signal: new AbortController().signal })).toThrow(
      'Stale'
    )
    expect(gate.snapshot('a').running).toBe(true)
  })
  it('does not let unregister erase running or uncertain state', () => {
    const gate = setup(),
      a = gate.begin('a')
    expect(() => gate.unregister('a')).toThrow()
    gate.markSideEffectStarting(a)
    gate.stop('a')
    gate.finish(a, 'failed')
    expect(() => gate.unregister('a')).toThrow()
    gate.acknowledgeUncertainty('a')
    gate.unregister('a')
    expect(() => gate.snapshot('a')).toThrow('Unknown tab')
  })
  it('handles repeated stop, protects other tabs, and rejects invalid identifiers', () => {
    const gate = setup(),
      b = gate.begin('b')
    gate.stop('a')
    gate.stop('a')
    expect(b.signal.aborted).toBe(false)
    expect(() => gate.register(' ')).toThrow('Invalid')
    expect(() => gate.register('a')).toThrow('already')
  })
  it('enforces a bounded number of registered tabs without losing existing state', () => {
    const gate = new AgentActionStopGate()
    for (let i = 0; i < 256; i++) gate.register(String(i))
    expect(() => gate.register('overflow')).toThrow('limit')
    expect(gate.snapshot('0').state).toBe('ready')
    gate.unregister('0')
    gate.register('overflow')
    expect(gate.snapshot('overflow').state).toBe('ready')
  })
  it('rejects invalid finish outcomes without clearing the action', () => {
    const gate = setup(),
      a = gate.begin('a')
    expect(() => gate.finish(a, 'unknown' as 'completed')).toThrow('Invalid outcome')
    expect(gate.snapshot('a').running).toBe(true)
  })
})
