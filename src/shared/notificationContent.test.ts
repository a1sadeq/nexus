import { describe, it, expect } from 'vitest'
import {
  cleanLine,
  formatDuration,
  formatNotificationContent,
  isNotificationDetail,
  modelLabel,
  DEFAULT_NOTIFICATION_DETAIL
} from './notificationContent'

describe('detail levels', () => {
  it('defaults to the level that names the tab, because the old text identified nothing', () => {
    expect(DEFAULT_NOTIFICATION_DETAIL).toBe('standard')
    const content = formatNotificationContent({ tabTitle: 'Refactor auth', model: 'gemini', status: 'done' })
    expect(content.body).toContain('Refactor auth')
    expect(content.body).toContain('Gemini')
  })

  it('keeps the old generic wording available, unchanged', () => {
    const done = formatNotificationContent({ tabTitle: 'Secret', status: 'done' }, { detail: 'generic' })
    expect(done).toEqual({ title: 'Nexus', body: 'An AI task has completed', urgency: 'normal' })
    const waiting = formatNotificationContent({ tabTitle: 'Secret', status: 'waiting-input' }, { detail: 'generic' })
    expect(waiting.body).toBe('An AI session requires your input')
  })

  it('never shows prompt text below the full level', () => {
    const standard = formatNotificationContent({
      tabTitle: 'Tab',
      model: 'claude',
      status: 'done',
      snippet: 'Here is the private answer'
    })
    expect(standard.body).not.toContain('private answer')
    const full = formatNotificationContent(
      { tabTitle: 'Tab', model: 'claude', status: 'done', snippet: 'Here is the private answer' },
      { detail: 'full' }
    )
    expect(full.body).toContain('private answer')
  })
})

describe('title', () => {
  it('says what happened and which model, so two popups are distinguishable', () => {
    const a = formatNotificationContent({ tabTitle: 'A', model: 'gemini', status: 'done' })
    const b = formatNotificationContent({ tabTitle: 'A', model: 'claude', status: 'done' })
    expect(a.title).toBe('Nexus — response ready · Gemini')
    expect(b.title).not.toBe(a.title)
  })

  it('marks input requests distinctly from completions', () => {
    const content = formatNotificationContent({ tabTitle: 'A', model: 'gemini', status: 'waiting-input' })
    expect(content.title).toContain('needs your input')
    expect(content.urgency).toBe('critical')
  })

  it('works without a model or a title', () => {
    const content = formatNotificationContent({ status: 'done' })
    expect(content.title).toBe('Nexus — response ready')
    expect(content.body.length).toBeGreaterThan(0)
  })

  it('accepts an application name', () => {
    const content = formatNotificationContent({ status: 'done' }, { appName: 'Arena' })
    expect(content.title.startsWith('Arena — ')).toBe(true)
  })
})

describe('facts in the body', () => {
  it('includes a duration only when one was measured', () => {
    const withDuration = formatNotificationContent({ tabTitle: 'T', model: 'gemini', status: 'done', durationMs: 67_000 })
    expect(withDuration.body).toContain('1m 07s')
    const without = formatNotificationContent({ tabTitle: 'T', model: 'gemini', status: 'done' })
    expect(without.body).not.toContain('s')
  })

  it('reports coalesced completions rather than dropping them silently', () => {
    const content = formatNotificationContent({ tabTitle: 'T', status: 'done', alsoFinished: 2 })
    expect(content.body).toContain('+2 more tabs finished')
  })

  it('uses the singular for one extra tab', () => {
    expect(formatNotificationContent({ tabTitle: 'T', status: 'done', alsoFinished: 1 }).body).toContain('+1 more tab')
  })

  it('never produces an empty body', () => {
    const content = formatNotificationContent({ status: 'waiting-input' })
    expect(content.body).toBe('Open Nexus to reply')
  })
})

describe('sanitising', () => {
  it('collapses control characters and newlines so the daemon cannot be fed a fake second line', () => {
    const content = formatNotificationContent({ tabTitle: 'evil\nTitle\u0007\u001b[31m', status: 'done' })
    expect(content.body).not.toContain('\u0007')
    expect(content.body.split('\n')[0]).toBe('evil Title [31m')
  })

  it('caps long titles with an ellipsis', () => {
    expect(cleanLine('x'.repeat(200), 20)).toHaveLength(20)
    expect(cleanLine('x'.repeat(200), 20).endsWith('…')).toBe(true)
  })

  it('ignores non-strings instead of rendering "undefined"', () => {
    expect(cleanLine(undefined, 10)).toBe('')
  })
})

describe('formatting helpers', () => {
  it('labels known models and prettifies unknown ones', () => {
    expect(modelLabel('gemini')).toBe('Gemini')
    expect(modelLabel('chatgpt')).toBe('ChatGPT')
    expect(modelLabel('some-new-model')).toBe('Some new model')
    expect(modelLabel(undefined)).toBe('')
  })

  it('formats durations at each scale without rounding up a whole unit', () => {
    expect(formatDuration(400)).toBe('less than a second')
    expect(formatDuration(8_000)).toBe('8s')
    expect(formatDuration(67_000)).toBe('1m 07s')
    expect(formatDuration(3_840_000)).toBe('1h 04m')
  })

  it('returns nothing for a duration it cannot trust', () => {
    expect(formatDuration(undefined)).toBe('')
    expect(formatDuration(-5)).toBe('')
    expect(formatDuration(Number.NaN)).toBe('')
  })

  it('validates detail names', () => {
    expect(isNotificationDetail('full')).toBe(true)
    expect(isNotificationDetail('verbose')).toBe(false)
    expect(isNotificationDetail(undefined)).toBe(false)
  })
})
