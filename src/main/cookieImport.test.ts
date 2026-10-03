import { describe, it, expect } from 'vitest'
import {
  parseCookieEditorJson,
  normalizeExpirationDate,
  AI_HOST_PATTERN,
  GOOGLE_HOST_PATTERN
} from './cookieImport'

describe('AI_HOST_PATTERN and GOOGLE_HOST_PATTERN', () => {
  it('matches all supported AI service hostnames', () => {
    const validHosts = [
      'google.com',
      'accounts.google.com',
      'gemini.google.com',
      'openai.com',
      'chatgpt.com',
      'auth0.openai.com',
      'anthropic.com',
      'claude.ai',
      'perplexity.ai',
      'deepseek.com',
      'chat.deepseek.com',
      'x.ai',
      'grok.com',
      'mistral.ai',
      'chat.mistral.ai'
    ]

    for (const host of validHosts) {
      expect(AI_HOST_PATTERN.test(host)).toBe(true)
    }

    expect(GOOGLE_HOST_PATTERN.test('google.com')).toBe(true)
    expect(GOOGLE_HOST_PATTERN.test('gemini.google.com')).toBe(true)
    expect(GOOGLE_HOST_PATTERN.test('googleapis.com')).toBe(true)
    expect(GOOGLE_HOST_PATTERN.test('gstatic.com')).toBe(true)
    expect(GOOGLE_HOST_PATTERN.test('googleusercontent.com')).toBe(true)
  })

  it('rejects unrelated hostnames', () => {
    const invalidHosts = ['github.com', 'example.com', 'reddit.com', 'facebook.com']
    for (const host of invalidHosts) {
      expect(AI_HOST_PATTERN.test(host)).toBe(false)
    }
  })
})

describe('parseCookieEditorJson', () => {
  it('parses valid Cookie-Editor JSON array into BrowserCookie list', () => {
    const sample = JSON.stringify([
      {
        domain: '.chatgpt.com',
        expirationDate: 1789000000,
        hostOnly: false,
        httpOnly: true,
        name: '__Secure-next-auth.session-token',
        path: '/',
        sameSite: 'lax',
        secure: true,
        value: 'test-session-secret-123'
      },
      {
        domain: '.claude.ai',
        expiry: 1789000000,
        httpOnly: true,
        name: 'sessionKey',
        path: '/',
        sameSite: 'no_restriction',
        secure: true,
        value: 'sk-ant-session'
      }
    ])

    const result = parseCookieEditorJson(sample)
    expect(result).toHaveLength(2)
    expect(result[0].name).toBe('__Secure-next-auth.session-token')
    expect(result[0].value).toBe('test-session-secret-123')
    expect(result[0].domain).toBe('.chatgpt.com')
    expect(result[0].httpOnly).toBe(true)
    expect(result[0].secure).toBe(true)
    expect(result[0].sameSite).toBe('lax')
    expect(result[0].expirationDate).toBe(1789000000)

    expect(result[1].name).toBe('sessionKey')
    expect(result[1].domain).toBe('.claude.ai')
    expect(result[1].sameSite).toBe('no_restriction')
    expect(result[1].expirationDate).toBe(1789000000)
  })

  it('handles single cookie object input', () => {
    const single = JSON.stringify({
      domain: '.google.com',
      name: 'SID',
      value: 'google-sid-token',
      path: '/',
      secure: true,
      httpOnly: true
    })

    const result = parseCookieEditorJson(single)
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('SID')
    expect(result[0].value).toBe('google-sid-token')
  })

  it('throws on invalid JSON or empty cookies', () => {
    expect(() => parseCookieEditorJson('not json')).toThrow('Invalid JSON format')
    expect(() => parseCookieEditorJson('[]')).toThrow('No valid cookies found')
    expect(() => parseCookieEditorJson('[{ "foo": "bar" }]')).toThrow('No valid cookies found')
  })
})

describe('normalizeExpirationDate', () => {
  it('handles Unix timestamp in seconds', () => {
    expect(normalizeExpirationDate(1789000000)).toBe(1789000000)
  })

  it('converts Firefox / Unix milliseconds to seconds', () => {
    expect(normalizeExpirationDate(1791409140599)).toBe(1791409140)
  })

  it('converts Chrome Windows epoch microseconds (1601) to Unix seconds (1970)', () => {
    // 13380000000000000 - 11644473600000000 = 1735526400000000 / 1e6 = 1735526400
    expect(normalizeExpirationDate(13380000000000000)).toBe(1735526400)
  })

  it('converts Chrome Windows epoch seconds (1601) to Unix seconds (1970)', () => {
    expect(normalizeExpirationDate(13450105228)).toBe(1805631628)
  })

  it('returns undefined for 0, negative, or undefined values', () => {
    expect(normalizeExpirationDate(undefined)).toBeUndefined()
    expect(normalizeExpirationDate(0)).toBeUndefined()
    expect(normalizeExpirationDate(-1)).toBeUndefined()
  })
})
