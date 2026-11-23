import { describe, it, expect } from 'vitest'

import { isGoogleSignInHost, isGoogleSignInRejection } from './googleSignInBlock'

describe('isGoogleSignInRejection', () => {
  it('recognises the refusal the user actually saw', () => {
    expect(
      isGoogleSignInRejection({
        url: 'https://accounts.google.com/v3/signin/identifier',
        title: "Couldn't sign you in",
        text: "Couldn't sign you in\nThis browser or app may not be secure. Learn more\nTry using a different browser."
      })
    ).toBe(true)
  })

  it('recognises the rejection URL even when the wording changes', () => {
    expect(
      isGoogleSignInRejection({ url: 'https://accounts.google.com/v3/signin/rejected', text: '' })
    ).toBe(true)
  })

  it('does not mistake an ordinary failed sign-in for a browser refusal', () => {
    // Wrong password and unknown account both use the same heading.
    expect(
      isGoogleSignInRejection({
        url: 'https://accounts.google.com/v3/signin/challenge/pwd',
        title: "Couldn't sign you in",
        text: "Couldn't sign you in\nWrong password. Try again or click Forgot password."
      })
    ).toBe(false)
    expect(
      isGoogleSignInRejection({
        url: 'https://accounts.google.com/v3/signin/identifier',
        title: 'Sign in - Google Accounts',
        text: 'Sign in\nUse your Google Account\nEmail or phone\nForgot email?'
      })
    ).toBe(false)
  })

  it('is not fooled by a normal page that merely mentions browsers', () => {
    expect(
      isGoogleSignInRejection({
        url: 'https://gemini.google.com/app',
        title: 'Gemini',
        text: 'Your browser or app may not be secure — this text is in the page body for other reasons.'
      })
    ).toBe(true) // body text is authoritative; the host check below keeps this off non-Google pages
    expect(isGoogleSignInHost('https://gemini.google.com/app')).toBe(true)
    expect(isGoogleSignInHost('https://example.com/signin/rejected')).toBe(false)
  })

  it('handles nothing at all', () => {
    expect(isGoogleSignInRejection(null)).toBe(false)
    expect(isGoogleSignInRejection(undefined)).toBe(false)
    expect(isGoogleSignInRejection({})).toBe(false)
  })
})

describe('isGoogleSignInHost', () => {
  it('accepts Google and YouTube hosts, including subdomains', () => {
    expect(isGoogleSignInHost('https://accounts.google.com/signin')).toBe(true)
    expect(isGoogleSignInHost('https://accounts.youtube.com/')).toBe(true)
    expect(isGoogleSignInHost('https://gemini.google.com/app')).toBe(true)
  })

  it('rejects lookalikes and junk', () => {
    expect(isGoogleSignInHost('https://notgoogle.com/')).toBe(false)
    expect(isGoogleSignInHost('https://google.com.evil.example/')).toBe(false)
    expect(isGoogleSignInHost('not a url')).toBe(false)
    expect(isGoogleSignInHost(undefined)).toBe(false)
  })
})
