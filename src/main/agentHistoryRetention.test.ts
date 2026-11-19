import { afterEach, describe, expect, it, vi } from 'vitest'
import { AgentHistory, type HistoryStore } from './agentHistory'
import { AgentHistoryRetention } from './agentHistoryRetention'

class MemoryStore implements HistoryStore {
  value: unknown = null
  read(): unknown | null {
    return structuredClone(this.value)
  }
  write(value: unknown): void {
    this.value = structuredClone(value)
  }
}
afterEach(() => vi.useRealTimers())

describe('local history periodic retention', () => {
  it('prunes expired records without requiring a new event', async () => {
    vi.useFakeTimers()
    let now = 100
    const history = new AgentHistory(new MemoryStore(), () => now)
    history.append({ kind: 'content', category: 'actions', text: 'expired' })
    const scheduler = new AgentHistoryRetention(history, () => {}, 60000)
    scheduler.start()
    now += 16 * 86400000
    await vi.advanceTimersByTimeAsync(60000)
    expect(history.records()).toEqual([])
    expect(scheduler.hasFailure()).toBe(false)
    scheduler.stop()
  })
  it('reports and remembers errors without exposing exception text, then retries', async () => {
    vi.useFakeTimers()
    const history = new AgentHistory(new MemoryStore(), () => 100)
    const spy = vi.spyOn(history, 'prune').mockImplementationOnce(() => {
      throw new Error('private')
    })
    const failure = vi.fn()
    const scheduler = new AgentHistoryRetention(history, failure, 60000)
    scheduler.start()
    await vi.advanceTimersByTimeAsync(60000)
    expect(scheduler.hasFailure()).toBe(true)
    expect(failure).toHaveBeenCalledWith()
    await vi.advanceTimersByTimeAsync(60000)
    expect(spy).toHaveBeenCalledTimes(2)
    expect(scheduler.hasFailure()).toBe(false)
    scheduler.stop()
  })
  it('stops timers and does not duplicate them on repeated start', async () => {
    vi.useFakeTimers()
    const history = new AgentHistory(new MemoryStore(), () => 100),
      spy = vi.spyOn(history, 'prune')
    const scheduler = new AgentHistoryRetention(history, () => {}, 60000)
    scheduler.start()
    scheduler.start()
    await vi.advanceTimersByTimeAsync(60000)
    expect(spy).toHaveBeenCalledTimes(1)
    scheduler.stop()
    scheduler.stop()
    await vi.advanceTimersByTimeAsync(120000)
    expect(spy).toHaveBeenCalledTimes(1)
  })
  it('does not duplicate a timer if a failure callback stops and restarts', async () => {
    vi.useFakeTimers()
    const history = new AgentHistory(new MemoryStore(), () => 100)
    const spy = vi.spyOn(history, 'prune').mockImplementationOnce(() => {
      throw new Error('private')
    })
    const scheduler = new AgentHistoryRetention(
      history,
      () => {
        scheduler.stop()
        scheduler.start()
      },
      60000
    )
    scheduler.start()
    await vi.advanceTimersByTimeAsync(120000)
    expect(spy).toHaveBeenCalledTimes(2)
    scheduler.stop()
  })
  it('does not let a failing notification callback stop future attempts', async () => {
    vi.useFakeTimers()
    const history = new AgentHistory(new MemoryStore(), () => 100)
    const spy = vi.spyOn(history, 'prune').mockImplementationOnce(() => {
      throw new Error('failure')
    })
    const scheduler = new AgentHistoryRetention(
      history,
      () => {
        throw new Error('notification failed')
      },
      60000
    )
    scheduler.start()
    await vi.advanceTimersByTimeAsync(120000)
    expect(spy).toHaveBeenCalledTimes(2)
    scheduler.stop()
  })
  it('rejects dangerously small or malformed intervals', () => {
    const history = new AgentHistory(new MemoryStore(), () => 100)
    expect(() => new AgentHistoryRetention(history, () => {}, 0)).toThrow()
    expect(() => new AgentHistoryRetention(history, () => {}, Infinity)).toThrow()
    expect(() => new AgentHistoryRetention(history, () => {}, 86400001)).toThrow()
  })
})
