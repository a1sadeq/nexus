import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  parseCookieEditorJson,
  normalizeExpirationDate,
  readCookiesFromCustomDirectory,
  AI_HOST_PATTERN,
  isGoogleCookieDomain,
  validateDomainForCookieImport,
  mapNumericSameSite
} from './cookieImport'

describe('AI_HOST_PATTERN', () => {
  it('matches all supported AI service hostnames including Google hosts', () => {
    const validHosts = [
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
      'chat.mistral.ai',
      'z.ai',
      'chat.z.ai',
      'copilot.microsoft.com',
      'bing.com',
      // Google hosts are now included in AI_HOST_PATTERN so readBrowserCookies(scope=all) covers them.
      'google.com',
      '.google.com',
      'accounts.google.com',
      'gemini.google.com',
      'googleapis.com',
      'gstatic.com',
      'googleusercontent.com'
    ]

    for (const host of validHosts) {
      expect(AI_HOST_PATTERN.test(host)).toBe(true)
    }
  })

  it('rejects lookalike hosts that merely contain z.ai', () => {
    expect(AI_HOST_PATTERN.test('quiz.ai')).toBe(false)
    expect(AI_HOST_PATTERN.test('amazon.z.ai.example.com')).toBe(false)
  })

  it('rejects dot-substituted lookalikes across known AI domains', () => {
    // If any literal dot in the regex were unescaped, these would match.
    // Every entry replaces exactly one '.' with an X to ensure the anchors
    // and escape sequences are tight.
    const lookalikes = [
      'chatgptXcom',
      'openaixcom',
      'claudeXai',
      'perplexityXai',
      'deepseekXcom',
      'grokXcom',
      'mistralXai',
      'zXai',
      'copilotXMicrosoftXcom',
      'bingXcom',
      'googleXeg',
      'googleapisXcom',
      'gstaticXcom',
      'googleusercontentXcom'
    ]
    for (const host of lookalikes) {
      expect(AI_HOST_PATTERN.test(host)).toBe(false)
    }
  })

  it('rejects unrelated hostnames', () => {
    const invalidHosts = ['github.com', 'example.com', 'reddit.com', 'facebook.com']
    for (const host of invalidHosts) {
      expect(AI_HOST_PATTERN.test(host)).toBe(false)
    }
  })
})

describe('isGoogleCookieDomain', () => {
  it('returns true for Google domains', () => {
    expect(isGoogleCookieDomain('google.com')).toBe(true)
    expect(isGoogleCookieDomain('.google.com')).toBe(true)
    expect(isGoogleCookieDomain('accounts.google.com')).toBe(true)
    expect(isGoogleCookieDomain('www.google.com')).toBe(true)
    expect(isGoogleCookieDomain('gemini.google.com')).toBe(true)
    expect(isGoogleCookieDomain('googleapis.com')).toBe(true)
    expect(isGoogleCookieDomain('gstatic.com')).toBe(true)
    expect(isGoogleCookieDomain('googleusercontent.com')).toBe(true)
  })

  it('returns false for non-Google domains', () => {
    expect(isGoogleCookieDomain('openai.com')).toBe(false)
    expect(isGoogleCookieDomain('chatgpt.com')).toBe(false)
    expect(isGoogleCookieDomain('anthropic.com')).toBe(false)
    expect(isGoogleCookieDomain('claude.ai')).toBe(false)
    expect(isGoogleCookieDomain('microsoft.com')).toBe(false)
    expect(isGoogleCookieDomain('example.com')).toBe(false)
  })
})

describe('validateDomainForCookieImport', () => {
  it('accepts supported non-Google providers', () => {
    const validDomains = [
      '.chatgpt.com',
      'chatgpt.com',
      'openai.com',
      'anthropic.com',
      '.claude.ai',
      'claude.ai',
      'perplexity.ai',
      'deepseek.com',
      'x.ai',
      'grok.com',
      'mistral.ai',
      'z.ai',
      'copilot.microsoft.com',
      'bing.com'
    ]
    for (const domain of validDomains) {
      const result = validateDomainForCookieImport(domain)
      expect(result.valid).toBe(true)
    }
  })

  it('accepts Google domains', () => {
    const googleDomains = [
      'google.com',
      '.google.com',
      'accounts.google.com',
      'gemini.google.com',
      'googleapis.com',
      'gstatic.com'
    ]
    for (const domain of googleDomains) {
      const result = validateDomainForCookieImport(domain)
      expect(result.valid).toBe(true)
    }
  })

  it('rejects unsupported domains', () => {
    const unsupportedDomains = ['github.com', 'example.com', 'facebook.com', 'unknown.com']
    for (const domain of unsupportedDomains) {
      const result = validateDomainForCookieImport(domain)
      expect(result.valid).toBe(false)
      expect(result.reason).toContain('not a supported AI provider')
    }
  })

  it('handles trailing dots and whitespace correctly', () => {
    expect(validateDomainForCookieImport('.chatgpt.com').valid).toBe(true)
    expect(validateDomainForCookieImport('chatgpt.com.').valid).toBe(true)
    expect(validateDomainForCookieImport('  chatgpt.com  ').valid).toBe(true)
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
      domain: '.chatgpt.com',
      name: 'session_token',
      value: 'test-chatgpt-token',
      path: '/',
      secure: true,
      httpOnly: true
    })

    const result = parseCookieEditorJson(single)
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('session_token')
    expect(result[0].value).toBe('test-chatgpt-token')
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

describe('readCookiesFromCustomDirectory', () => {
  it('throws for non-existent directory', async () => {
    await expect(readCookiesFromCustomDirectory('/path/that/does/not/exist')).rejects.toThrow(
      'Directory does not exist'
    )
  })

  it('throws if directory does not contain cookie database', async () => {
    await expect(readCookiesFromCustomDirectory('/tmp')).rejects.toThrow(
      'No browser cookie database'
    )
  })
})

describe('mapNumericSameSite', () => {
  it('maps 0 to no_restriction, 1 to lax, 2 to strict', () => {
    expect(mapNumericSameSite(0)).toBe('no_restriction')
    expect(mapNumericSameSite(1)).toBe('lax')
    expect(mapNumericSameSite(2)).toBe('strict')
    expect(mapNumericSameSite(99)).toBe('unspecified')
    expect(mapNumericSameSite(undefined)).toBe('unspecified')
  })
})

describe('validateDomainForCookieImport accepts Google domains', () => {
  it('accepts .google.com, accounts.google.com, gemini.google.com', () => {
    const googleDomains = ['google.com', '.google.com', 'accounts.google.com', 'gemini.google.com']
    for (const d of googleDomains) {
      const result = validateDomainForCookieImport(d)
      expect(result.valid).toBe(true)
    }
  })

  it('still rejects non-AI, non-Google domains', () => {
    expect(validateDomainForCookieImport('github.com').valid).toBe(false)
    expect(validateDomainForCookieImport('example.com').valid).toBe(false)
  })
})

describe('Google cookies are accepted by import', () => {
  it('parseCookieEditorJson parses Google cookies correctly', () => {
    const googleOnly = JSON.stringify([
      {
        domain: '.google.com',
        expirationDate: 1789000000,
        hostOnly: false,
        httpOnly: true,
        name: '__Secure-3pSID',
        path: '/',
        sameSite: 'no_restriction',
        secure: true,
        value: 'google-session'
      }
    ])
    const cookies = parseCookieEditorJson(googleOnly)
    expect(cookies).toHaveLength(1)
    expect(cookies[0].name).toBe('__Secure-3pSID')
    expect(cookies[0].domain).toBe('.google.com')
    // Validation should accept this domain now
    const validation = validateDomainForCookieImport(cookies[0].domain!)
    expect(validation.valid).toBe(true)
  })
})

describe('Mixed JSON imports supported providers including Google', () => {
  it('filters only supported domains', () => {
    const mixed = JSON.stringify([
      {
        domain: 'chatgpt.com',
        expirationDate: 1789000000,
        hostOnly: true,
        httpOnly: true,
        name: 'session',
        path: '/',
        sameSite: 'lax',
        secure: true,
        value: 'chatgpt-token'
      },
      {
        domain: '.google.com',
        expirationDate: 1789000000,
        hostOnly: false,
        httpOnly: true,
        name: 'SSID',
        path: '/',
        sameSite: 'none',
        secure: true,
        value: 'google-id'
      },
      {
        domain: 'anthropic.com',
        expirationDate: 1789000000,
        hostOnly: true,
        httpOnly: false,
        name: 'auth_token',
        path: '/',
        sameSite: 'lax',
        secure: true,
        value: 'claude-sess'
      }
    ])
    const cookies = parseCookieEditorJson(mixed)
    expect(cookies).toHaveLength(3)
    // All three should be valid now
    const valid = cookies.filter((c) => validateDomainForCookieImport(c.domain!).valid)
    expect(valid).toHaveLength(3)
  })
})

// ---------------------------------------------------------------------------
// Scope behavior & auth-detection DB-level tests
// ---------------------------------------------------------------------------

import {
  _test_chromeProfileInfo,
  _test_firefoxProfileInfo
} from './cookieImport'
import {
  buildFakeChromeCookieDb,
  buildFakeFirefoxCookieDb,
  fakeChromeProfile,
  fakeFirefoxProfile,
  destroyFakeChromeProfile,
  destroyFakeFirefoxProfile
} from './cookieImport.test_helpers'
import { readBrowserCookies } from './cookieImport'

const CHATGPT_DOMAIN = 'chatgpt.com'
const GOOGLE_DOMAIN = 'accounts.google.com'
const GOOGLE_SUBDOMAIN = 'gemini.google.com'

// Common timestamps (seconds since Unix epoch)
const PAST_TIMESTAMP = 1_700_000_000
const RECENT_TIMESTAMP = 1_790_000_000

describe('readBrowserCookies scope: all vs google', () => {
  let chromeProfile: ReturnType<typeof fakeChromeProfile>

  beforeEach(() => {
    chromeProfile = fakeChromeProfile([
      // Non-Google AI cookies
      {
        host_key: CHATGPT_DOMAIN,
        name: 'openai_session',
        value: 'chatgpt-val',
        path: '/',
        is_secure: 1,
        expires_utc: RECENT_TIMESTAMP * 1e6, // Chrome uses microseconds
        last_access_utc: RECENT_TIMESTAMP * 1e6
      },
      {
        host_key: 'anthropic.com',
        name: 'anthropic_auth',
        value: 'claude-val',
        path: '/',
        is_secure: 1,
        expires_utc: RECENT_TIMESTAMP * 1e6,
        last_access_utc: RECENT_TIMESTAMP * 1e6
      },
      // Google cookies (non-auth + auth)
      {
        host_key: GOOGLE_DOMAIN,
        name: 'NID',
        value: 'personalized-cookie',
        path: '/',
        is_secure: 1,
        expires_utc: RECENT_TIMESTAMP * 1e6,
        last_access_utc: RECENT_TIMESTAMP * 1e6
      },
      {
        host_key: GOOGLE_SUBDOMAIN,
        name: 'SID',
        value: 'google-session-id',
        path: '/',
        is_secure: 1,
        expires_utc: RECENT_TIMESTAMP * 1e6,
        last_access_utc: RECENT_TIMESTAMP * 1e6
      },
      {
        host_key: GOOGLE_DOMAIN,
        name: '__Secure-1PSID',
        value: 'secure-psid',
        path: '/',
        is_secure: 1,
        expires_utc: RECENT_TIMESTAMP * 1e6,
        last_access_utc: RECENT_TIMESTAMP * 1e6
      }
    ])
  })

  afterEach(() => {
    destroyFakeChromeProfile(chromeProfile)
  })

  it('[T1] scope=all returns Google + non-Google AI cookies', async () => {
    const all = await readBrowserCookies(chromeProfile, 'all')
    const names = all.map((c) => c.name)
    // Should include both non-Google AI cookies AND Google cookies
    expect(names).toContain('openai_session')
    expect(names).toContain('anthropic_auth')
    expect(names).toContain('NID')
    expect(names).toContain('SID')
    expect(names).toContain('__Secure-1PSID')
  })

  it('[T2] scope=google returns ONLY Google cookies', async () => {
    const googleOnly = await readBrowserCookies(chromeProfile, 'google')
    const names = googleOnly.map((c) => c.name)
    // Should NOT include non-Google AI cookies
    expect(names).not.toContain('openai_session')
    expect(names).not.toContain('anthropic_auth')
    // SHOULD include Google cookies
    expect(names).toContain('NID')
    expect(names).toContain('SID')
    expect(names).toContain('__Secure-1PSID')
  })
})

describe('Firefox scope behavior', () => {
  let ffProfile: ReturnType<typeof fakeFirefoxProfile>

  beforeEach(() => {
    ffProfile = fakeFirefoxProfile([
      {
        host: 'chatgpt.com',
        name: 'openai_session',
        value: 'chatgpt-val',
        path: '/',
        expiry: RECENT_TIMESTAMP,
        lastAccessed: RECENT_TIMESTAMP,
        isSecure: 1,
        isHttpOnly: 1
      },
      {
        host: 'accounts.google.com',
        name: 'SID',
        value: 'ff-google-sid',
        path: '/',
        expiry: RECENT_TIMESTAMP,
        lastAccessed: RECENT_TIMESTAMP,
        isSecure: 1,
        isHttpOnly: 1
      },
      {
        host: 'accounts.google.com',
        name: 'NID',
        value: 'ff-nid',
        path: '/',
        expiry: RECENT_TIMESTAMP,
        lastAccessed: RECENT_TIMESTAMP,
        isSecure: 1,
        isHttpOnly: 1
      }
    ])
  })

  afterEach(() => {
    destroyFakeFirefoxProfile(ffProfile)
  })

  it('scope=all includes Google and non-Google cookies in Firefox', async () => {
    const all = await readBrowserCookies(ffProfile, 'all')
    const names = all.map((c) => c.name)
    expect(names).toContain('openai_session')
    expect(names).toContain('SID')
    expect(names).toContain('NID')
  })

  it('scope=google includes ONLY Google cookies in Firefox', async () => {
    const googleOnly = await readBrowserCookies(ffProfile, 'google')
    const names = googleOnly.map((c) => c.name)
    expect(names).not.toContain('openai_session')
    expect(names).toContain('SID')
    expect(names).toContain('NID')
  })
})

describe('hasGoogleAuth DB-level detection (T8/T9)', () => {
  describe('Chrome', () => {
    it('[T8] DB with only unrelated cookies → hasGoogleAuth=false', () => {
      const { dbPath } = buildFakeChromeCookieDb([
        {
          host_key: 'example.com',
          name: 'session_id',
          value: 'abc123',
          path: '/',
          expires_utc: RECENT_TIMESTAMP * 1e6,
          last_access_utc: RECENT_TIMESTAMP * 1e6
        },
        {
          host_key: 'myapp.com',
          name: 'user_token',
          value: 'xyz',
          path: '/',
          expires_utc: RECENT_TIMESTAMP * 1e6,
          last_access_utc: RECENT_TIMESTAMP * 1e6
        }
      ])
      const info = _test_chromeProfileInfo(dbPath)
      expect(info.hasGoogleAuth).toBe(false)
      expect(info.detectedAiSessions).toEqual([])
    })

    it('[T8-b] DB with NID but NO SID-family → hasGoogleAuth=false', () => {
      const { dbPath } = buildFakeChromeCookieDb([
        {
          host_key: 'accounts.google.com',
          name: 'NID',
          value: 'some-nid-value',
          path: '/',
          expires_utc: RECENT_TIMESTAMP * 1e6,
          last_access_utc: RECENT_TIMESTAMP * 1e6
        },
        {
          host_key: 'google.com',
          name: 'APISID',
          value: 'some-apisi-value',
          path: '/',
          expires_utc: RECENT_TIMESTAMP * 1e6,
          last_access_utc: RECENT_TIMESTAMP * 1e6
        }
      ])
      const info = _test_chromeProfileInfo(dbPath)
      expect(info.hasGoogleAuth).toBe(false)
    })

    it('[T9] DB with SID → hasGoogleAuth=true', () => {
      const { dbPath } = buildFakeChromeCookieDb([
        {
          host_key: 'accounts.google.com',
          name: 'SID',
          value: 'real-session-id',
          path: '/',
          is_secure: 1,
          expires_utc: RECENT_TIMESTAMP * 1e6,
          last_access_utc: RECENT_TIMESTAMP * 1e6
        }
      ])
      const info = _test_chromeProfileInfo(dbPath)
      expect(info.hasGoogleAuth).toBe(true)
    })

    it('[T9-b] DB with __Secure-1PSID → hasGoogleAuth=true', () => {
      const { dbPath } = buildFakeChromeCookieDb([
        {
          host_key: 'accounts.google.com',
          name: '__Secure-1PSID',
          value: 'secure-psid-value',
          path: '/',
          is_secure: 1,
          expires_utc: RECENT_TIMESTAMP * 1e6,
          last_access_utc: RECENT_TIMESTAMP * 1e6
        }
      ])
      const info = _test_chromeProfileInfo(dbPath)
      expect(info.hasGoogleAuth).toBe(true)
    })

    it('[T9-c] DB with __Secure-3PSID → hasGoogleAuth=true', () => {
      const { dbPath } = buildFakeChromeCookieDb([
        {
          host_key: 'accounts.google.com',
          name: '__Secure-3PSID',
          value: '3psid-value',
          path: '/',
          is_secure: 1,
          expires_utc: RECENT_TIMESTAMP * 1e6,
          last_access_utc: RECENT_TIMESTAMP * 1e6
        }
      ])
      const info = _test_chromeProfileInfo(dbPath)
      expect(info.hasGoogleAuth).toBe(true)
    })
  })

  describe('Firefox/Zen', () => {
    it('[T8] Moz_cookies without SID-family → hasGoogleAuth=false', () => {
      const { dbPath } = buildFakeFirefoxCookieDb([
        {
          host: 'example.com',
          name: 'csrf_token',
          value: 'token-abc',
          path: '/',
          expiry: RECENT_TIMESTAMP,
          lastAccessed: RECENT_TIMESTAMP,
          isSecure: 1,
          isHttpOnly: 1
        }
      ])
      const info = _test_firefoxProfileInfo(dbPath)
      expect(info.hasGoogleAuth).toBe(false)
    })

    it('[T8-b] Moz_cookies with NID only → hasGoogleAuth=false', () => {
      const { dbPath } = buildFakeFirefoxCookieDb([
        {
          host: 'accounts.google.com',
          name: 'NID',
          value: 'firefox-nid',
          path: '/',
          expiry: RECENT_TIMESTAMP,
          lastAccessed: RECENT_TIMESTAMP,
          isSecure: 1,
          isHttpOnly: 1
        }
      ])
      const info = _test_firefoxProfileInfo(dbPath)
      expect(info.hasGoogleAuth).toBe(false)
    })

    it('[T9] Moz_cookies with SID → hasGoogleAuth=true', () => {
      const { dbPath } = buildFakeFirefoxCookieDb([
        {
          host: 'accounts.google.com',
          name: 'SID',
          value: 'ff-sid-real',
          path: '/',
          expiry: RECENT_TIMESTAMP,
          lastAccessed: RECENT_TIMESTAMP,
          isSecure: 1,
          isHttpOnly: 1
        }
      ])
      const info = _test_firefoxProfileInfo(dbPath)
      expect(info.hasGoogleAuth).toBe(true)
    })
  })
})

describe('provider recency ignores unrelated domains (T4 extension)', () => {
  it('[Chrome] lastAccessed reflects AI domain, not unrelated old domain', () => {
    const { dbPath } = buildFakeChromeCookieDb([
      // Unrelated domain accessed long ago
      {
        host_key: 'old-site.example.com',
        name: 'session',
        value: 'old',
        path: '/',
        expires_utc: PAST_TIMESTAMP * 1e6,
        last_access_utc: PAST_TIMESTAMP * 1e6
      },
      // Recent AI domain access
      {
        host_key: 'chatgpt.com',
        name: 'openai_session',
        value: 'new',
        path: '/',
        expires_utc: RECENT_TIMESTAMP * 1e6,
        last_access_utc: RECENT_TIMESTAMP * 1e6
      }
    ])
    const info = _test_chromeProfileInfo(dbPath)
    // lastAccessed should reflect the RECENT AI domain, not the old unrelated one
    expect(info.lastAccessed).toBeGreaterThanOrEqual(RECENT_TIMESTAMP - 1)
    expect(info.lastAccessed).toBeLessThanOrEqual(RECENT_TIMESTAMP + 1)
  })

  it('[Firefox] lastAccessed reflects AI domain over unrelated old domain', () => {
    const { dbPath } = buildFakeFirefoxCookieDb([
      {
        host: 'old-site.example.com',
        name: 'session',
        value: 'old',
        path: '/',
        expiry: PAST_TIMESTAMP,
        lastAccessed: PAST_TIMESTAMP
      },
      {
        host: 'anthropic.com',
        name: 'auth_token',
        value: 'new',
        path: '/',
        expiry: RECENT_TIMESTAMP,
        lastAccessed: RECENT_TIMESTAMP
      }
    ])
    const info = _test_firefoxProfileInfo(dbPath)
    expect(info.lastAccessed).toBeGreaterThanOrEqual(RECENT_TIMESTAMP - 1)
    expect(info.lastAccessed).toBeLessThanOrEqual(RECENT_TIMESTAMP + 1)
  })
})
