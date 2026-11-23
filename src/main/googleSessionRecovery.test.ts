import { describe, expect, it } from 'vitest'
import { isGoogleLoginRecoveryUrl } from './googleSessionRecovery'

describe('isGoogleLoginRecoveryUrl', () => {
  it.each([
    'https://gemini.google.com/signin?continue=1',
    'https://chatgpt.com/auth/login'
  ])('accepts a provider login wall: %s', url => expect(isGoogleLoginRecoveryUrl(url)).toBe(true))

  it.each([
    // Google's own sign-in page no longer triggers recovery. It used to, and recovery reloads the view
    // when a session exists — reloading the login page, which navigates again: an endless refresh.
    'https://accounts.google.com/ServiceLogin',
    'https://accounts.google.com/v3/signin/identifier',
    'https://gemini.google.com/app',
    'https://evil.example/?next=https://accounts.google.com',
    'https://accounts.google.com.evil.example/',
    'http://accounts.google.com/',
    'not a URL'
  ])('rejects %s', url => expect(isGoogleLoginRecoveryUrl(url)).toBe(false))
})
