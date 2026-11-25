import { describe, it, expect } from 'vitest'
import {
  NavigationIntentTracker,
  isDuplicateNavigation,
  DUPLICATE_NAVIGATION_WINDOW_MS,
  sameSiteUrl
} from './navigationIntent'

const URL_A = 'https://arena.ai/agent/'
const URL_B = 'https://chatgpt.com/'

describe('isDuplicateNavigation', () => {
  it('is false when there is no previous request', () => {
    expect(isDuplicateNavigation(undefined, URL_A, 1000)).toBe(false)
  })

  it('is true for the same url inside the window', () => {
    expect(isDuplicateNavigation({ url: URL_A, at: 1000 }, URL_A, 1100)).toBe(true)
  })

  it('is true at the exact start of the window', () => {
    expect(isDuplicateNavigation({ url: URL_A, at: 1000 }, URL_A, 1000)).toBe(true)
  })

  it('is false once the window has passed', () => {
    expect(
      isDuplicateNavigation({ url: URL_A, at: 1000 }, URL_A, 1000 + DUPLICATE_NAVIGATION_WINDOW_MS)
    ).toBe(false)
    expect(
      isDuplicateNavigation({ url: URL_A, at: 1000 }, URL_A, 1000 + DUPLICATE_NAVIGATION_WINDOW_MS - 1)
    ).toBe(true)
  })

  it('is false for a different url — a real navigation must abort the older load', () => {
    expect(isDuplicateNavigation({ url: URL_A, at: 1000 }, URL_B, 1010)).toBe(false)
  })

  it('is false for an empty url', () => {
    expect(isDuplicateNavigation({ url: URL_A, at: 1000 }, '', 1010)).toBe(false)
  })

  it('is false when the clock is inconsistent', () => {
    expect(isDuplicateNavigation({ url: URL_A, at: 2000 }, URL_A, 1000)).toBe(false)
  })

  it('honours a custom window', () => {
    expect(isDuplicateNavigation({ url: URL_A, at: 1000 }, URL_A, 1200, 100)).toBe(false)
    expect(isDuplicateNavigation({ url: URL_A, at: 1000 }, URL_A, 1050, 100)).toBe(true)
  })
})

describe('NavigationIntentTracker', () => {
  it('accepts the first request and drops the immediate repeat', () => {
    const tracker = new NavigationIntentTracker()
    expect(tracker.claim('tab-1', URL_A, 1000)).toBe(true)
    expect(tracker.claim('tab-1', URL_A, 1100)).toBe(false)
    expect(tracker.pendingUrl('tab-1')).toBe(URL_A)
  })

  it('keeps tabs independent', () => {
    const tracker = new NavigationIntentTracker()
    expect(tracker.claim('tab-1', URL_A, 1000)).toBe(true)
    expect(tracker.claim('tab-2', URL_A, 1001)).toBe(true)
  })

  it('lets a different url through and replaces the pending entry', () => {
    const tracker = new NavigationIntentTracker()
    expect(tracker.claim('tab-1', URL_A, 1000)).toBe(true)
    expect(tracker.claim('tab-1', URL_B, 1001)).toBe(true)
    expect(tracker.pendingUrl('tab-1')).toBe(URL_B)
    // the older url may now be requested again: it is no longer the pending one
    expect(tracker.claim('tab-1', URL_A, 1002)).toBe(true)
  })

  it('allows the same url again after forget()', () => {
    const tracker = new NavigationIntentTracker()
    expect(tracker.claim('tab-1', URL_A, 1000)).toBe(true)
    tracker.forget('tab-1')
    expect(tracker.claim('tab-1', URL_A, 1010)).toBe(true)
  })

  it('allows the same url again after the window expires', () => {
    const tracker = new NavigationIntentTracker(200)
    expect(tracker.claim('tab-1', URL_A, 1000)).toBe(true)
    expect(tracker.claim('tab-1', URL_A, 1100)).toBe(false)
    expect(tracker.claim('tab-1', URL_A, 1250)).toBe(true)
  })

  it('clear() forgets everything', () => {
    const tracker = new NavigationIntentTracker()
    tracker.claim('tab-1', URL_A, 1000)
    tracker.clear()
    expect(tracker.pendingUrl('tab-1')).toBeUndefined()
    expect(tracker.claim('tab-1', URL_A, 1001)).toBe(true)
  })

  it('forget() on an unknown tab is a no-op', () => {
    const tracker = new NavigationIntentTracker()
    expect(() => tracker.forget('nope')).not.toThrow()
    expect(tracker.pendingUrl('nope')).toBeUndefined()
  })
})

describe('sameSiteUrl', () => {
  it('treats a redirect within a provider as the same site', () => {
    expect(sameSiteUrl('https://www.perplexity.ai/search/new?q=geim', 'https://www.perplexity.ai/search?q=geim')).toBe(true)
    expect(sameSiteUrl('https://gemini.google.com/app', 'https://gemini.google.com')).toBe(true)
  })

  it('ignores a leading www and a missing trailing slash', () => {
    expect(sameSiteUrl('https://google.com/', 'https://google.com')).toBe(true)
    expect(sameSiteUrl('https://www.google.com/', 'https://google.com')).toBe(true)
  })

  it('says no when the tab is still on the page it was on before', () => {
    expect(sameSiteUrl('https://www.perplexity.ai/session/f41e', 'https://google.com')).toBe(false)
    expect(sameSiteUrl('https://google.com', 'https://gemini.google.com')).toBe(false)
  })

  it('is false for empty or unparseable input', () => {
    expect(sameSiteUrl('', 'https://google.com')).toBe(false)
    expect(sameSiteUrl('https://google.com', undefined)).toBe(false)
    expect(sameSiteUrl('not a url', 'https://google.com')).toBe(false)
  })
})
