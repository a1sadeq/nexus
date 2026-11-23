import { describe, it, expect } from 'vitest'

import {
  ReloadGuard,
  isGoogleSignInPage,
  isProviderLoginWall,
  isThirdPartyAuthPage,
  shouldAutoRecoverFromBrowser
} from './loginWall'

describe('isGoogleSignInPage', () => {
  it('recognises the pages the user signs in on', () => {
    expect(isGoogleSignInPage('https://accounts.google.com/v3/signin/identifier')).toBe(true)
    expect(isGoogleSignInPage('https://accounts.google.com/o/oauth2/v2/auth?client_id=x')).toBe(true)
    expect(isGoogleSignInPage('https://accounts.youtube.com/')).toBe(true)
  })

  it('does not claim provider or unrelated pages', () => {
    expect(isGoogleSignInPage('https://gemini.google.com/app')).toBe(false)
    expect(isGoogleSignInPage('https://example.com/accounts.google.com')).toBe(false)
    expect(isGoogleSignInPage('not a url')).toBe(false)
  })
})

describe('isProviderLoginWall', () => {
  it('recognises the walls recovery was written for', () => {
    expect(isProviderLoginWall('https://gemini.google.com/signin')).toBe(true)
    expect(isProviderLoginWall('https://chatgpt.com/auth/login')).toBe(true)
    expect(isProviderLoginWall('https://claude.ai/login')).toBe(true)
    expect(isProviderLoginWall('https://perplexity.ai/login')).toBe(true)
  })

  it('never treats Google sign-in itself as a provider wall — that was the refresh loop', () => {
    // Recovery used to reload the view here, which reloaded the login page, which navigated again.
    expect(isProviderLoginWall('https://accounts.google.com/v3/signin/identifier')).toBe(false)
    expect(shouldAutoRecoverFromBrowser('https://accounts.google.com/v3/signin/identifier')).toBe(
      false
    )
  })

  it('leaves ordinary provider pages alone', () => {
    expect(isProviderLoginWall('https://gemini.google.com/app/abc123')).toBe(false)
    expect(isProviderLoginWall('https://arena.ai/agent/01a1f14b')).toBe(false)
    expect(isProviderLoginWall('')).toBe(false)
  })
})

describe('ReloadGuard', () => {
  it('allows the first reload', () => {
    const guard = new ReloadGuard()
    expect(guard.shouldReload('tab-1', 'https://x.test')).toEqual({ allow: true })
  })

  it('refuses the same URL again inside the cooldown', () => {
    const guard = new ReloadGuard(3, 10_000)
    guard.record('tab-1', 'https://x.test', 1000)

    const decision = guard.shouldReload('tab-1', 'https://x.test', 2000)
    expect(decision.allow).toBe(false)
    expect(decision.reason).toMatch(/moments ago/)
  })

  it('allows it again after the cooldown', () => {
    const guard = new ReloadGuard(3, 10_000)
    guard.record('tab-1', 'https://x.test', 1000)

    expect(guard.shouldReload('tab-1', 'https://x.test', 20_000)).toEqual({ allow: true })
  })

  it('runs out after the budget, whatever the URL', () => {
    const guard = new ReloadGuard(2, 0)
    guard.record('tab-1', 'https://a.test')
    guard.record('tab-1', 'https://b.test')

    const decision = guard.shouldReload('tab-1', 'https://c.test')
    expect(decision.allow).toBe(false)
    expect(decision.reason).toMatch(/2 reloads/)
  })

  it('keeps tabs independent, and can forget one', () => {
    const guard = new ReloadGuard(1, 0)
    guard.record('tab-1', 'https://a.test')

    expect(guard.shouldReload('tab-2', 'https://a.test')).toEqual({ allow: true })
    guard.forget('tab-1')
    expect(guard.shouldReload('tab-1', 'https://a.test')).toEqual({ allow: true })
  })
})

describe('isThirdPartyAuthPage', () => {
  it('covers the pages a person types a password into', () => {
    expect(isThirdPartyAuthPage('https://accounts.google.com/v3/signin/accountchooser')).toBe(true)
    expect(isThirdPartyAuthPage('https://accounts.google.com/o/oauth2/v2/auth?x=1')).toBe(true)
    expect(isThirdPartyAuthPage('https://login.microsoftonline.com/common/oauth2')).toBe(true)
    expect(isThirdPartyAuthPage('https://appleid.apple.com/auth/authorize')).toBe(true)
    expect(isThirdPartyAuthPage('https://sso.example.com/login')).toBe(true)
  })

  it('leaves the AI products themselves alone', () => {
    expect(isThirdPartyAuthPage('https://gemini.google.com/app')).toBe(false)
    expect(isThirdPartyAuthPage('https://chatgpt.com/c/123')).toBe(false)
    expect(isThirdPartyAuthPage('https://arena.ai/agent/01a1f14b')).toBe(false)
    expect(isThirdPartyAuthPage('about:blank')).toBe(false)
  })
})
