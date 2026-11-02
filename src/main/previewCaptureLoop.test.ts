import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PreviewCaptureLoop } from './previewCaptureLoop'

function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r }); return { promise, resolve } }
beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())
describe('bounded preview scheduler', () => {
  it('single-flights overlapping requests and coalesces extra triggers', async () => {
    const d = deferred<string>(); const capture = vi.fn(() => d.promise)
    const loop = new PreviewCaptureLoop({ capture, publish: vi.fn(), canCapture: () => true })
    loop.start('A'); await vi.advanceTimersByTimeAsync(0)
    for (let i = 0; i < 20; i++) loop.request()
    await vi.advanceTimersByTimeAsync(5000)
    expect(capture).toHaveBeenCalledTimes(1)
    d.resolve('frame'); await vi.advanceTimersByTimeAsync(0)
    expect(capture).toHaveBeenCalledTimes(2)
    loop.stop(); expect(vi.getTimerCount()).toBe(0)
  })
  it('does not emit a stopped session or launch a second native capture on restart', async () => {
    const a = deferred<string>(); const publish = vi.fn()
    const capture = vi.fn((id: string) => id === 'A' ? a.promise : Promise.resolve('B frame'))
    const loop = new PreviewCaptureLoop({ capture, publish, canCapture: () => true })
    loop.start('A'); await vi.advanceTimersByTimeAsync(0)
    loop.stop(); loop.start('B'); await vi.advanceTimersByTimeAsync(2000)
    expect(capture).toHaveBeenCalledTimes(1)
    a.resolve('A frame'); await vi.advanceTimersByTimeAsync(0)
    expect(publish).toHaveBeenCalledWith('B frame')
    expect(publish).not.toHaveBeenCalledWith('A frame')
    loop.stop()
  })
  it('rejects late frames after stop', async () => {
    const a = deferred<string>(); const publish = vi.fn()
    const loop = new PreviewCaptureLoop({ capture: () => a.promise, publish, canCapture: () => true })
    loop.start('A'); await vi.advanceTimersByTimeAsync(0); loop.stop()
    a.resolve('late'); await vi.advanceTimersByTimeAsync(0)
    expect(publish).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0)
  })
  it('does not capture hidden/minimized windows and suppresses unchanged IPC frames', async () => {
    let visible = false; const capture = vi.fn(async () => 'same'); const publish = vi.fn()
    const loop = new PreviewCaptureLoop({ capture, publish, canCapture: () => visible })
    loop.start('A'); await vi.advanceTimersByTimeAsync(3000)
    expect(capture).not.toHaveBeenCalled()
    visible = true; await vi.advanceTimersByTimeAsync(2000)
    expect(capture).toHaveBeenCalledTimes(2); expect(publish).toHaveBeenCalledTimes(1)
    loop.stop()
  })
  it('recovers from capture rejection without unhandled rejections', async () => {
    const capture = vi.fn().mockRejectedValueOnce(new Error('navigation')).mockResolvedValue('ok')
    const publish = vi.fn(); const loop = new PreviewCaptureLoop({ capture, publish, canCapture: () => true })
    loop.start('A'); await vi.advanceTimersByTimeAsync(1000)
    expect(publish).toHaveBeenCalledWith('ok'); loop.stop()
  })
})
