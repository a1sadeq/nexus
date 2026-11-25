import { beforeEach, describe, expect, it } from 'vitest'

import {
  adoptNativeIdentity,
  configureProviderHosts,
  configureUserAgents,
  desiredIdentityFor,
  forgetNativeIdentity,
  hasNativeIdentity,
  hasPermanentNativeIdentity,
  hostOf,
  identityReason,
  isGoogleOwnedUrl,
  isProviderHost,
  releaseNativeIdentity,
  resetIdentityRegistry,
  resolveIdentityForRequest,
  syncIdentity,
  type IdentityWebContents
} from './webIdentity'

const AI_UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36'
const NATIVE_UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Nexus/1.1.0 Chrome/140.0 Electron/38.0 Safari/537.36'

const SIGN_IN = 'https://accounts.google.com/v3/signin/identifier?continue=x'
const GOOGLE_HOME = 'https://www.google.com/?zx=1795557773676'
const CONSENT = 'https://consent.google.com/m?continue=https://www.google.com/'
const CONSENT_YOUTUBE = 'https://accounts.youtube.com/accounts/SetSID'
const ACCOUNT_SETTINGS = 'https://myaccount.google.com/security'
const GEMINI = 'https://gemini.google.com/app'
const AISTUDIO = 'https://aistudio.google.com/prompts/new_chat'
const PROVIDER = 'https://chatgpt.com/c/1'
const NOT_GOOGLE = 'https://github.com/login'
// A provider page pulling an asset off a Google host: must not re-identify the page around it.
const ASSET = 'https://www.gstatic.com/images/branding/product/1x/googleg_32dp.png'

function fakeContents(id: number, { destroyed = false } = {}): IdentityWebContents & {
  userAgents: string[]
  destroyed: boolean
} {
  const fake = {
    id,
    destroyed,
    userAgents: [] as string[],
    setUserAgent(ua: string) {
      this.userAgents.push(ua)
    },
    isDestroyed() {
      return this.destroyed
    }
  }
  return fake
}

beforeEach(() => {
  resetIdentityRegistry()
  configureUserAgents({ ai: AI_UA, native: NATIVE_UA })
  configureProviderHosts(['chatgpt.com', 'claude.ai', 'gemini.google.com', 'aistudio.google.com'])
})

describe('Google’s own properties get the honest identity', () => {
  it('covers every page a sign-in flow hops through', () => {
    // This is the bug the user hit: the flow goes accounts.google.com → www.google.com → consent, and
    // every hop has to look like the same browser as the one before it.
    for (const url of [SIGN_IN, GOOGLE_HOME, CONSENT, CONSENT_YOUTUBE, ACCOUNT_SETTINGS]) {
      expect(isGoogleOwnedUrl(url)).toBe(true)
      expect(desiredIdentityFor(url)).toBe('native')
    }
  })

  it('does not cover an account settings page differently from a search page', () => {
    // Both are Google's, both present honestly; the earlier rule split them for no reason.
    expect(desiredIdentityFor(ACCOUNT_SETTINGS)).toBe(desiredIdentityFor(GOOGLE_HOME))
  })

  it('leaves the AI products on the Chrome-shaped identity even though Google owns them', () => {
    expect(desiredIdentityFor(GEMINI)).toBe('ai')
    expect(desiredIdentityFor(AISTUDIO)).toBe('ai')
    expect(isProviderHost('gemini.google.com')).toBe(true)
    // A provider's subdomain too, so a regional host cannot slip back to native.
    expect(isProviderHost('eu.gemini.google.com')).toBe(true)
  })

  it('leaves every other site alone', () => {
    for (const url of [PROVIDER, NOT_GOOGLE, 'https://example.com', undefined, 'not a url']) {
      expect(desiredIdentityFor(url)).toBe('ai')
    }
  })

  it('is a pure function of the URL, so it cannot oscillate', () => {
    const urls = [SIGN_IN, GOOGLE_HOME, CONSENT, GEMINI, PROVIDER, CONSENT_YOUTUBE]
    for (const url of urls) {
      const first = desiredIdentityFor(url)
      for (let i = 0; i < 5; i += 1) expect(desiredIdentityFor(url)).toBe(first)
    }
  })

  it('says why, so the console line names the rule it hit', () => {
    expect(identityReason(GEMINI)).toContain('AI provider')
    expect(identityReason(GOOGLE_HOME)).toContain('Google property')
    expect(identityReason(NOT_GOOGLE)).toContain('not Google')
    expect(identityReason(PROVIDER)).toContain('AI provider')
    expect(hostOf(GOOGLE_HOME)).toBe('www.google.com')
    expect(hostOf('nonsense')).toBe('')
  })
})

describe('the registry', () => {
  it('states the identity on the page itself, not only in the request', () => {
    const contents = fakeContents(1)
    expect(adoptNativeIdentity(contents, NATIVE_UA)).toBe(true)
    expect(contents.userAgents).toEqual([NATIVE_UA])
    expect(hasNativeIdentity(1)).toBe(true)
    expect(hasPermanentNativeIdentity(1)).toBe(false)
  })

  it('marks the sign-in window as permanent, and never takes it back', () => {
    const contents = fakeContents(2)
    expect(adoptNativeIdentity(contents, NATIVE_UA, { permanent: true })).toBe(true)
    expect(hasPermanentNativeIdentity(2)).toBe(true)
    expect(releaseNativeIdentity(contents)).toBe(false)
    expect(contents.userAgents).toEqual([NATIVE_UA])
    // Even navigating to a provider: the window keeps its identity for its whole life.
    expect(syncIdentity(contents, GEMINI, { permanent: true })).toBe('native')
    expect(contents.userAgents).toEqual([NATIVE_UA])
  })

  it('hands the identity back to a page that leaves Google', () => {
    const contents = fakeContents(3)
    adoptNativeIdentity(contents, NATIVE_UA)
    expect(releaseNativeIdentity(contents)).toBe(true)
    expect(contents.userAgents).toEqual([NATIVE_UA, AI_UA])
    expect(hasNativeIdentity(3)).toBe(false)
    expect(releaseNativeIdentity(contents)).toBe(false)
  })

  it('never touches a destroyed page, and never writes an empty user agent', () => {
    const destroyed = fakeContents(4, { destroyed: true })
    expect(adoptNativeIdentity(destroyed, NATIVE_UA)).toBe(false)
    expect(destroyed.userAgents).toEqual([])

    resetIdentityRegistry()
    const contents = fakeContents(6)
    adoptNativeIdentity(contents, NATIVE_UA)
    releaseNativeIdentity(contents)
    expect(contents.userAgents).not.toContain('')
  })

  it('survives being handed no page at all', () => {
    expect(adoptNativeIdentity(null, NATIVE_UA)).toBe(false)
    expect(adoptNativeIdentity(undefined, NATIVE_UA)).toBe(false)
    expect(releaseNativeIdentity(null)).toBe(false)
    expect(syncIdentity(null, SIGN_IN)).toBe('ai')
    expect(hasNativeIdentity(undefined)).toBe(false)
    expect(hasPermanentNativeIdentity(undefined)).toBe(false)
  })

  it('forgets a page that has gone, so a recycled id starts clean', () => {
    const contents = fakeContents(7)
    adoptNativeIdentity(contents, NATIVE_UA)
    forgetNativeIdentity(7)
    expect(hasNativeIdentity(7)).toBe(false)
    expect(hasPermanentNativeIdentity(7)).toBe(false)
  })
})

describe('syncIdentity — what the navigation watcher does', () => {
  it('puts a page on the identity its URL calls for, once', () => {
    const contents = fakeContents(10)
    expect(syncIdentity(contents, GOOGLE_HOME)).toBe('native')
    expect(syncIdentity(contents, GOOGLE_HOME)).toBe('native')
    // One setUserAgent, not one per navigation event: repeating the same URL changes nothing.
    expect(contents.userAgents).toEqual([NATIVE_UA])
  })

  it('does not flip between Google’s own pages', () => {
    const contents = fakeContents(11)
    for (const url of [SIGN_IN, GOOGLE_HOME, CONSENT, CONSENT_YOUTUBE, GOOGLE_HOME]) {
      expect(syncIdentity(contents, url)).toBe('native')
    }
    // No release and re-adopt for each hop — the whole point of the fix.
    expect(contents.userAgents).toEqual([NATIVE_UA])
  })

  it('gives the identity back when the page reaches a provider', () => {
    const contents = fakeContents(12)
    syncIdentity(contents, SIGN_IN)
    expect(syncIdentity(contents, GEMINI)).toBe('ai')
    expect(contents.userAgents).toEqual([NATIVE_UA, AI_UA])
  })
})

describe('resolveIdentityForRequest', () => {
  it('switches a document before it exists, and only once', () => {
    expect(
      resolveIdentityForRequest({ url: GOOGLE_HOME, isMainFrame: true, webContentsId: 20 })
    ).toEqual({ identity: 'native', adopt: true, release: false })
    adoptNativeIdentity(fakeContents(20), NATIVE_UA)
    expect(
      resolveIdentityForRequest({ url: GOOGLE_HOME, isMainFrame: true, webContentsId: 20 })
    ).toEqual({ identity: 'native', adopt: false, release: false })
  })

  it('never switches on a sub-resource, whatever host it comes from', () => {
    // A tab on gemini.google.com pulls an image from gstatic: the page keeps the Chrome-shaped
    // identity and the image request is sent as the page, not as a different browser.
    expect(
      resolveIdentityForRequest({ url: ASSET, isMainFrame: false, webContentsId: 21 })
    ).toEqual({ identity: 'ai', adopt: false, release: false })

    adoptNativeIdentity(fakeContents(22), NATIVE_UA)
    expect(
      resolveIdentityForRequest({ url: ASSET, isMainFrame: false, webContentsId: 22 })
    ).toEqual({ identity: 'native', adopt: false, release: false })
    expect(
      resolveIdentityForRequest({ url: SIGN_IN, isMainFrame: false, webContentsId: 22 })
    ).toEqual({ identity: 'native', adopt: false, release: false })
  })

  it('reports the release when the page navigates to a provider', () => {
    adoptNativeIdentity(fakeContents(23), NATIVE_UA)
    expect(
      resolveIdentityForRequest({ url: GEMINI, isMainFrame: true, webContentsId: 23 })
    ).toEqual({ identity: 'ai', adopt: false, release: true })
  })

  it('never adopts or releases the sign-in window', () => {
    const contents = fakeContents(24)
    adoptNativeIdentity(contents, NATIVE_UA, { permanent: true })
    expect(
      resolveIdentityForRequest({ url: SIGN_IN, isMainFrame: true, webContentsId: 24 })
    ).toEqual({ identity: 'native', adopt: false, release: false })
    expect(
      resolveIdentityForRequest({ url: GEMINI, isMainFrame: true, webContentsId: 24 })
    ).toEqual({ identity: 'native', adopt: false, release: false })
  })

  it('leaves an ordinary page alone', () => {
    expect(
      resolveIdentityForRequest({ url: PROVIDER, isMainFrame: true, webContentsId: 25 })
    ).toEqual({ identity: 'ai', adopt: false, release: false })
    expect(
      resolveIdentityForRequest({ url: SIGN_IN, isMainFrame: true, webContentsId: undefined })
    ).toEqual({ identity: 'native', adopt: false, release: false })
  })

  it('is stable across a real sign-in hop sequence', () => {
    // The reported failure, as a sequence: what a tab sees while adding a second Google account.
    const contents = fakeContents(26)
    const hops = [
      'https://accounts.google.com/ServiceLogin?continue=https://gemini.google.com/app',
      GOOGLE_HOME,
      CONSENT,
      'https://accounts.google.com/signin/v2/challenge/pwd',
      'https://www.google.com/?zx=1795557773677',
      'https://gemini.google.com/app'
    ]
    const seen: string[] = []
    for (const url of hops) {
      const decision = resolveIdentityForRequest({ url, isMainFrame: true, webContentsId: 26 })
      if (decision.adopt) adoptNativeIdentity(contents, NATIVE_UA)
      if (decision.release) releaseNativeIdentity(contents)
      seen.push(decision.identity)
    }
    expect(seen).toEqual(['native', 'native', 'native', 'native', 'native', 'ai'])
    // Adopted once, released once — never a flip per hop.
    expect(contents.userAgents).toEqual([NATIVE_UA, AI_UA])
  })
})
