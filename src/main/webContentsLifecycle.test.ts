import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { closeWebContents } from './webContentsLifecycle'

function fixture() {
  const events = new EventEmitter()
  let destroyed = false
  const contents = {
    close: vi.fn(() => { destroyed = true; events.emit('destroyed') }),
    isDestroyed: () => destroyed,
    once: (name: 'destroyed', fn: () => void) => events.once(name, fn),
    removeListener: (name: 'destroyed', fn: () => void) => events.removeListener(name, fn)
  }
  return { contents, events, destroy: () => { destroyed = true; events.emit('destroyed') } }
}
afterEach(() => vi.useRealTimers())
describe('public WebContents lifecycle', () => {
  it('uses close, not a cast-only destroy, and cleans listeners', async () => {
    const f = fixture()
    await closeWebContents(f.contents)
    expect(f.contents.close).toHaveBeenCalledWith({ waitForBeforeUnload: false })
    expect(f.events.listenerCount('destroyed')).toBe(0)
  })
  it('does not close an already destroyed contents', async () => {
    const f = fixture(); f.destroy()
    await closeWebContents(f.contents)
    expect(f.contents.close).not.toHaveBeenCalled()
  })
  it('waits for a delayed native destroyed event', async () => {
    const f = fixture(); f.contents.close.mockImplementation(() => {})
    let done = false
    const p = closeWebContents(f.contents).then(() => { done = true })
    await Promise.resolve(); expect(done).toBe(false)
    f.destroy(); await p; expect(done).toBe(true)
  })
  it('rejects native errors and removes its listener', async () => {
    const f = fixture(); f.contents.close.mockImplementation(() => { throw new Error('native failure') })
    await expect(closeWebContents(f.contents)).rejects.toThrow('native failure')
    expect(f.events.listenerCount('destroyed')).toBe(0)
  })
  it('times out rather than declaring a still-live contents destroyed', async () => {
    vi.useFakeTimers()
    const f = fixture(); f.contents.close.mockImplementation(() => {})
    const result = expect(closeWebContents(f.contents, 50)).rejects.toThrow('remains tracked')
    await vi.advanceTimersByTimeAsync(50); await result
    expect(f.events.listenerCount('destroyed')).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })
})
