import { describe, expect, it } from 'vitest'
import { isGoogleLoginRecoveryUrl } from './googleSessionRecovery'

describe('isGoogleLoginRecoveryUrl', () => {
  it.each([
    'https://accounts.google.com/ServiceLogin',
    'https://gemini.google.com/signin?continue=1'
  ])('accepts %s', url => expect(isGoogleLoginRecoveryUrl(url)).toBe(true))
  it.each([
    'https://gemini.google.com/app',
    'https://evil.example/?next=https://accounts.google.com',
    'https://accounts.google.com.evil.example/',
    'http://accounts.google.com/',
    'not a URL'
  ])('rejects %s', url => expect(isGoogleLoginRecoveryUrl(url)).toBe(false))
})
