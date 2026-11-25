import { describe, it, expect } from 'vitest'
import {
  createNavTrace,
  describeLoadError,
  describeLoadFailure,
  formatEvent,
  shortUrl
} from './navTrace'

function clock(start = 1_000) {
  let t = start
  return () => {
    t += 5
    return t
  }
}

describe('nav trace ring buffer', () => {
  it('records tab, kind, message and data in order with a monotonic id', () => {
    const trace = createNavTrace({ now: clock() })
    trace.record('t1', 'request', 'navigate_tab', { url: 'https://a.example' })
    trace.record('t1', 'load', 'loadURL')
    trace.record('t2', 'event', 'did-stop-loading')

    const events = trace.events()
    expect(events.map((e) => e.seq)).toEqual([1, 2, 3])
    expect(events[0].data).toEqual({ url: 'https://a.example' })
    expect(events[1].data).toBeUndefined()
    expect(trace.lastSeq()).toBe(3)
  })

  it('keeps both the global and the per-tab history bounded', () => {
    const trace = createNavTrace({ limit: 5, perTabLimit: 3, now: clock() })
    for (let i = 0; i < 10; i += 1) trace.record('t1', 'load', `load ${i}`)
    trace.record('t2', 'load', 'other tab')

    expect(trace.events()).toHaveLength(5)
    expect(trace.forTab('t1')).toHaveLength(3)
    expect(trace.forTab('t1').map((e) => e.message)).toEqual(['load 7', 'load 8', 'load 9'])
    expect(trace.tabs()).toEqual(['t1', 't2'])
  })

  it('answers "everything since #N" so a reader can follow along', () => {
    const trace = createNavTrace({ now: clock() })
    trace.record('t1', 'load', 'first')
    const mark = trace.lastSeq()
    trace.record('t1', 'abort', 'second')
    expect(trace.since(mark).map((e) => e.message)).toEqual(['second'])
    expect(trace.since(0)).toHaveLength(2)
  })

  it('records even when verbose printing is off — the panel still has the story', () => {
    const lines: string[] = []
    const trace = createNavTrace({ now: clock(), sink: (line) => lines.push(line), verbose: () => false })
    trace.record('t1', 'request', 'navigate_tab', { url: 'https://x.example' })
    expect(lines).toEqual([])
    expect(trace.forTab('t1')).toHaveLength(1)
    expect(trace.isVerbose()).toBe(false)

    trace.setVerbose(true)
    trace.record('t1', 'load', 'loadURL')
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('loadURL')
    expect(lines[0]).toContain('[t1]')
  })

  it('mirrors to the console when verbose and survives a sink that throws', () => {
    const trace = createNavTrace({
      now: clock(),
      verbose: () => true,
      sink: () => {
        throw new Error('console is gone')
      }
    })
    expect(() => trace.record('t1', 'note', 'still here')).not.toThrow()
    expect(trace.forTab('t1')).toHaveLength(1)
  })

  it('clears on request without resetting the sequence', () => {
    const trace = createNavTrace({ now: clock() })
    trace.record('t1', 'load', 'a')
    trace.clear()
    expect(trace.events()).toEqual([])
    expect(trace.forTab('t1')).toEqual([])
    const next = trace.record('t1', 'load', 'b')
    expect(next.seq).toBe(2)
  })
})

describe('nav trace formatting', () => {
  it('puts the kind, the tab and the relative time on one line', () => {
    const trace = createNavTrace({ now: clock() })
    const event = trace.record('tab-1', 'abort', 'load of https://a.example aborted', {
      code: -3,
      attempt: 1
    })
    const line = formatEvent(event)
    expect(line).toContain('#1')
    expect(line).toContain('abort')
    expect(line).toContain('[tab-1]')
    expect(line).toContain('load of https://a.example aborted')
    expect(line).toContain('code=-3')
    expect(line).toContain('attempt=1')
  })

  it('survives a circular payload instead of losing the line', () => {
    const trace = createNavTrace({ now: clock() })
    const circular: Record<string, unknown> = { name: 'loop' }
    circular.self = circular
    expect(() =>
      trace.record('tab-1', 'note', 'weird', circular as Record<string, unknown>)
    ).not.toThrow()
    expect(() => trace.formatAll()).not.toThrow()
  })

  it('prints a tab report that names the tab and says when it is empty', () => {
    const trace = createNavTrace({ now: clock() })
    expect(trace.formatForTab('missing', 10, 'Gemini')).toContain(
      'nothing recorded for this tab yet'
    )
    trace.record('t1', 'request', 'navigate_tab', { url: 'https://b.example' })
    const report = trace.formatForTab('t1', 10, 'Gemini')
    expect(report.split('\n')[0]).toContain('Navigation trace for Gemini')
    expect(report).toContain('navigate_tab')
  })
})

describe('load failure wording', () => {
  it('names the common Chromium codes so the trace reads like English', () => {
    expect(describeLoadFailure(-3, 'ERR_ABORTED')).toContain('something started another navigation')
    expect(describeLoadFailure(-105, 'ERR_NAME_NOT_RESOLVED')).toContain('name not resolved')
    expect(describeLoadFailure(-7, 'ERR_TIMED_OUT')).toContain('timed out')
    expect(describeLoadFailure(-2, 'ERR_FAILED')).toContain('load cancelled')
    expect(describeLoadFailure(-202, 'ERR_CERT_AUTHORITY_INVALID')).toBe(
      '-202 ERR_CERT_AUTHORITY_INVALID'
    )
  })

  it('recognises the abort both by code and by errno', () => {
    expect(describeLoadError({ code: 'ERR_ABORTED' })).toBe('ERR_ABORTED (-3)')
    expect(describeLoadError({ errno: -3 })).toBe('ERR_ABORTED (-3)')
    expect(describeLoadError({ message: 'boom' })).toBe('boom')
  })
})

describe('repeat folding', () => {
  it('folds identical events inside the window into one line with a count', () => {
    let t = 1_000
    const trace = createNavTrace({ now: () => t, repeatWindowMs: 250 })
    trace.record('tab-1', 'note', 'URL report accepted', { reported: 'https://kimi.ai/chat' })
    t += 5
    trace.record('tab-1', 'note', 'URL report accepted', { reported: 'https://kimi.ai/chat' })
    t += 5
    trace.record('tab-1', 'note', 'URL report accepted', { reported: 'https://kimi.ai/chat' })

    const events = trace.events()
    expect(events).toHaveLength(1)
    expect(events[0].count).toBe(3)
    expect(trace.lastSeq()).toBe(1)
    expect(formatEvent(events[0])).toContain('×3')
  })

  it('keeps a repeat that arrives after the window, and never folds a different message', () => {
    let t = 1_000
    const trace = createNavTrace({ now: () => t, repeatWindowMs: 100 })
    trace.record('tab-1', 'note', 'URL report accepted', { reported: 'a' })
    t += 500
    trace.record('tab-1', 'note', 'URL report accepted', { reported: 'a' })
    trace.record('tab-1', 'note', 'URL report accepted', { reported: 'b' })
    expect(trace.events()).toHaveLength(3)
    expect(trace.events().every((event) => event.count === undefined)).toBe(true)
  })

  it('does not fold across tabs or kinds', () => {
    const trace = createNavTrace({ now: () => 1_000, repeatWindowMs: 10_000 })
    trace.record('tab-1', 'load', 'loadURL', { url: 'https://a.example' })
    trace.record('tab-2', 'load', 'loadURL', { url: 'https://a.example' })
    trace.record('tab-2', 'abort', 'loadURL', { url: 'https://a.example' })
    expect(trace.events()).toHaveLength(3)
  })
})

describe('shortUrl', () => {
  it('leaves a short URL alone and trims a long one to host + path', () => {
    expect(shortUrl('https://kimi.ai/')).toBe('https://kimi.ai/')
    const long = 'https://www.kimi.ai/chat/c/1795563309831-abcdefghijklmnop/really/deep/path?token=secret'
    const trimmed = shortUrl(long, 46)
    expect(trimmed.length).toBeLessThanOrEqual(46)
    expect(trimmed).toContain('www.kimi.ai')
  })

  it('does not throw on a value that is not a URL', () => {
    expect(shortUrl('not a url at all but a long string that should still fit somewhere', 20)).toHaveLength(20)
  })
})
