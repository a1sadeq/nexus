import { describe, it, expect } from 'vitest'
import {
  cleanLine,
  formatDuration,
  formatNotificationContent,
  isNotificationDetail,
  modelLabel,
  statusDescription,
  statusLabel,
  DEFAULT_NOTIFICATION_DETAIL
} from './notificationContent'

describe('detail levels', () => {
  it('defaults to the level that names the tab, because the old text identified nothing', () => {
    expect(DEFAULT_NOTIFICATION_DETAIL).toBe('standard')
    const content = formatNotificationContent({ tabTitle: 'Refactor auth', model: 'gemini', status: 'done' })
    // Build 51: the tab's title is the *title* (that is what the user asked for), and the body carries
    // the same description the in-app card prints, followed by the facts that card shows as a badge.
    expect(content.title).toBe('Refactor auth')
    expect(content.body).toContain('Generation completed.')
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
  it('is the tab it came from, so two popups are distinguishable at a glance', () => {
    const a = formatNotificationContent({ tabTitle: 'Refactor auth', model: 'gemini', status: 'done' })
    const b = formatNotificationContent({ tabTitle: 'Pricing page', model: 'gemini', status: 'done' })
    expect(a.title).toBe('Refactor auth')
    expect(b.title).toBe('Pricing page')
    expect(a.title).not.toBe(b.title)
  })

  it('marks input requests distinctly in the body, and asks the OS to insist on them', () => {
    const content = formatNotificationContent({ tabTitle: 'A', model: 'gemini', status: 'waiting-input' })
    expect(content.title).toBe('A')
    expect(content.body.split('\n')[0]).toBe('Waiting for your choice or confirmation')
    expect(content.body).toContain('Needs Input')
    expect(content.urgency).toBe('critical')
  })

  it('works without a model or a title', () => {
    const content = formatNotificationContent({ status: 'done' })
    expect(content.title).toBe('Nexus · Response Ready')
    expect(content.body.length).toBeGreaterThan(0)
  })

  it('accepts an application name', () => {
    const content = formatNotificationContent({ status: 'done' }, { appName: 'Arena' })
    expect(content.title).toBe('Arena · Response Ready')
  })

  it('caps a runaway tab title instead of letting it eat the popup', () => {
    const content = formatNotificationContent({ tabTitle: 'x'.repeat(200), status: 'done' })
    expect(content.title).toHaveLength(80)
  })
})

describe('the same description the in-app card prints', () => {
  it('is the answer text at full detail, and the plain status sentence otherwise', () => {
    const card = statusDescription('done', 'Here is the finished thing')
    const full = formatNotificationContent(
      { tabTitle: 'T', status: 'done', snippet: 'Here is the finished thing' },
      { detail: 'full' }
    )
    expect(full.body.split('\n')[0]).toBe(card)
    const standard = formatNotificationContent(
      { tabTitle: 'T', status: 'done', snippet: 'Here is the finished thing' }
    )
    expect(standard.body).not.toContain('finished thing')
    expect(standard.body.split('\n')[0]).toBe(statusDescription('done', undefined))
  })

  it('names the two states once, for both surfaces', () => {
    expect(statusLabel('done')).toBe('Response Ready')
    expect(statusLabel('waiting-input')).toBe('Needs Input')
    expect(statusDescription('waiting-input', undefined)).toBe('Waiting for your choice or confirmation')
    expect(statusDescription('done', '   ')).toBe('Generation completed.')
  })
})

describe('facts in the body', () => {
  it('includes a duration only when one was measured', () => {
    const withDuration = formatNotificationContent({ tabTitle: 'T', model: 'gemini', status: 'done', durationMs: 67_000 })
    expect(withDuration.body).toContain('1m 07s')
    const without = formatNotificationContent({ tabTitle: 'T', model: 'gemini', status: 'done' })
    expect(without.body).not.toContain('1m 07s')
    expect(without.body.split('\n')[1]).toBe('Response Ready · Gemini')
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
    expect(content.body.length).toBeGreaterThan(0)
    expect(content.body.split('\n')[0]).toBe('Waiting for your choice or confirmation')
  })
})

describe('sanitising', () => {
  it('collapses control characters and newlines so the daemon cannot be fed a fake second line', () => {
    const content = formatNotificationContent({ tabTitle: 'evil\nTitle\u0007\u001b[31m', status: 'done' })
    expect(content.title).not.toContain('\u0007')
    // The title is one line: a tab title cannot forge a second line in the popup either.
    expect(content.title).toBe('evil Title [31m')
    expect(content.body.split('\n')).toHaveLength(2)
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
