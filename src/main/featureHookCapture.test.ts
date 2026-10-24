import { EventEmitter } from 'events'
import type { WebContents } from 'electron'
import { describe, it, expect, vi } from 'vitest'
import { executeHookCapture, hookContextId } from './featureHookCapture'

function fake(execute = () => Promise.resolve({ ok: true })) {
  return Object.assign(new EventEmitter(), { id: 1, getURL: () => 'https://arena.ai/agent/example', executeJavaScript: execute }) as unknown as WebContents
}

describe('bounded host capture ownership', () => {
  it('returns result and clears in-flight ownership after success', async () => {
    const contents = fake()
    expect(await executeHookCapture(contents, 'script')).toEqual({ ok: true })
    expect(await executeHookCapture(contents, 'script')).toEqual({ ok: true })
  })
  it('rejects concurrent work and retains guard after timeout until execution settles', async () => {
    let finish!: (value: { ok: boolean }) => void
    const execute = vi.fn().mockImplementationOnce(() => new Promise(resolve => { finish = resolve })).mockResolvedValue({ ok: true })
    const contents = fake(execute)
    const first = executeHookCapture(contents, 'script', 10)
    await expect(executeHookCapture(contents, 'script')).rejects.toThrow('capture_in_progress')
    await expect(first).rejects.toThrow('capture_timeout')
    await expect(executeHookCapture(contents, 'script')).rejects.toThrow('capture_in_progress')
    finish({ ok: true })
    await Promise.resolve(); await Promise.resolve()
    expect(await executeHookCapture(contents, 'script')).toEqual({ ok: true })
  })
  it('cleans up rejection paths and allows retry', async () => {
    const execute = vi.fn().mockRejectedValueOnce(new Error('renderer destroyed')).mockResolvedValueOnce({ ok: true })
    const contents = fake(execute)
    await expect(executeHookCapture(contents, 'script')).rejects.toThrow('renderer destroyed')
    expect(await executeHookCapture(contents, 'script')).toEqual({ ok: true })
  })
  it('detects navigation away-and-back even when final URL is identical', () => {
    const contents = fake(), before = hookContextId(contents)
    contents.emit('did-start-navigation', {}, 'https://other.test', false, true)
    contents.emit('did-start-navigation', {}, contents.getURL(), false, true)
    expect(hookContextId(contents)).not.toBe(before)
    expect(contents.listenerCount('did-start-navigation')).toBe(1)
    hookContextId(contents)
    expect(contents.listenerCount('did-start-navigation')).toBe(1)
  })
  it('does not invalidate a top-document context for subframe navigation', () => {
    const contents = fake(), before = hookContextId(contents)
    contents.emit('did-start-navigation', {}, 'https://captcha.test', false, false)
    expect(hookContextId(contents)).toBe(before)
  })
})
