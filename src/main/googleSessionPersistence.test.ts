import { describe, expect, it } from 'vitest'
import { isGoogleSessionCookie } from './googleSessionPersistence'

describe('Google cookie persistence scope', () => {
  it('matches Google hosts, not unrelated or lookalike hosts', () => {
    expect(isGoogleSessionCookie('.google.com')).toBe(true)
    expect(isGoogleSessionCookie('accounts.google.com')).toBe(true)
    expect(isGoogleSessionCookie('openai.com')).toBe(false)
    expect(isGoogleSessionCookie('google.com.evil.test')).toBe(false)
  })
})
