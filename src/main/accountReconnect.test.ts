import { describe, expect, it, vi } from 'vitest'

import {
  clearGoogleSessionCookies,
  isGoogleSessionCookieDomain,
  reconnectAccount,
  reconnectTargetFor,
  signInUrlForFreshLogin,
  type ReconnectDeps,
  type ReconnectEvent
} from './accountReconnect'
import { defaultContainer } from './containers'

const LOGIN_URL =
  'https://accounts.google.com/ServiceLogin?hl=en&passive=true&continue=' +
  encodeURIComponent('https://gemini.google.com/signin?continue=https%3A%2F%2Fgemini.google.com%2Fapp') +
  '&flowName=GlifWebSignIn&flowEntry=ServiceLogin'

const target = { containerId: 'work', containerName: 'Work', accountId: 'work' }

function harness(overrides: Partial<ReconnectDeps> = {}) {
  const order: string[] = []
  const events: ReconnectEvent[] = []
  const deps: ReconnectDeps = {
    clearSession: vi.fn(async (accountId: string) => {
      order.push(`clear:${accountId}`)
    }),
    reloadContainer: vi.fn((containerId: string) => {
      order.push(`reload:${containerId}`)
    }),
    startSignIn: vi.fn(async (accountId: string, url: string) => {
      order.push(`signin:${accountId}:${new URL(url).searchParams.get('prompt')}`)
    }),
    report: (event: ReconnectEvent) => events.push(event),
    ...overrides
  }
  return { deps, order, events }
}

describe('signInUrlForFreshLogin', () => {
  it('asks for the account chooser instead of signing in silently', () => {
    const url = new URL(signInUrlForFreshLogin(LOGIN_URL))
    expect(url.searchParams.get('prompt')).toBe('select_account')
    expect(url.searchParams.get('passive')).toBe('false')
  })

  it('keeps the continuation target, so the new account lands on Gemini', () => {
    const url = new URL(signInUrlForFreshLogin(LOGIN_URL))
    expect(url.searchParams.get('continue')).toBe(
      'https://gemini.google.com/signin?continue=https%3A%2F%2Fgemini.google.com%2Fapp'
    )
    expect(url.searchParams.get('flowEntry')).toBe('ServiceLogin')
  })

  it('is idempotent — asking twice does not stack parameters', () => {
    const once = signInUrlForFreshLogin(LOGIN_URL)
    expect(signInUrlForFreshLogin(once)).toBe(once)
  })

  it('survives a URL with no query string at all', () => {
    const url = new URL(signInUrlForFreshLogin('https://accounts.google.com/ServiceLogin'))
    expect(url.searchParams.get('prompt')).toBe('select_account')
    expect(url.searchParams.get('passive')).toBe('false')
  })
})

describe('reconnectTargetFor', () => {
  it('carries the container id and its account, with a name fit to print', () => {
    expect(reconnectTargetFor({ id: 'default', name: '  ', accountId: 'default', createdAt: 0 })).toEqual({
      containerId: 'default',
      containerName: 'default',
      accountId: 'default'
    })
    expect(reconnectTargetFor(defaultContainer()).containerName).toBe('Default')
  })
})

describe('reconnectAccount', () => {
  it('clears the store, reloads the tabs, then opens the chooser — in that order', async () => {
    const { deps, order, events } = harness()
    const result = await reconnectAccount(target, deps, LOGIN_URL)

    expect(result).toEqual({ ok: true })
    expect(order).toEqual(['clear:work', 'reload:work', 'signin:work:select_account'])
    expect(events.map((e) => e.stage)).toEqual(['clearing', 'cleared', 'signing-in'])
  })

  it('does not open a sign-in window when the store would not clear', async () => {
    const { deps, order, events } = harness({
      clearSession: vi.fn(async () => {
        throw new Error('EBUSY')
      })
    })
    const result = await reconnectAccount(target, deps, LOGIN_URL)

    expect(result.ok).toBe(false)
    expect(result.error).toContain('Work')
    expect(result.error).toContain('EBUSY')
    expect(order).toEqual([])
    expect(deps.startSignIn).not.toHaveBeenCalled()
    expect(events.at(-1)).toEqual({ stage: 'failed', message: result.error })
  })

  it('reports a clear failure honestly instead of claiming a sign-out happened', async () => {
    const { deps, events } = harness({
      clearSession: vi.fn(async () => {
        throw new Error('no such partition')
      })
    })
    await reconnectAccount(target, deps, LOGIN_URL)
    expect(events.some((e) => e.stage === 'cleared')).toBe(false)
  })

  it('says so when the session was cleared but the window would not open', async () => {
    const { deps, events } = harness({
      startSignIn: vi.fn(async () => {
        throw new Error('window closed')
      })
    })
    const result = await reconnectAccount(target, deps, LOGIN_URL)

    expect(result.ok).toBe(false)
    expect(result.error).toContain('cleared')
    expect(events.map((e) => e.stage)).toEqual(['clearing', 'cleared', 'failed'])
  })

  it('reconnects the default account too — it is a profile like any other', async () => {
    const { deps, order } = harness()
    const result = await reconnectAccount(
      { containerId: 'default', containerName: 'Default', accountId: 'default' },
      deps,
      LOGIN_URL
    )
    expect(result.ok).toBe(true)
    expect(order).toEqual(['clear:default', 'reload:default', 'signin:default:select_account'])
  })
})

describe('isGoogleSessionCookieDomain', () => {
  it('recognises every host that carries a Google identity', () => {
    for (const domain of [
      '.google.com',
      '.accounts.google.com',
      'google.com',
      '.google.co.uk',
      '.googleusercontent.com',
      '.gstatic.com',
      '.googleapis.com',
      '.youtube.com'
    ]) {
      expect(isGoogleSessionCookieDomain(domain), domain).toBe(true)
    }
  })

  it('leaves every other provider alone', () => {
    for (const domain of [
      '.chatgpt.com',
      '.claude.ai',
      '.gemini.google.com.evil.test',
      'notgoogle.com',
      '.arena.ai',
      ''
    ]) {
      expect(isGoogleSessionCookieDomain(domain), domain).toBe(false)
    }
  })
})

describe('clearGoogleSessionCookies', () => {
  const jarOf = (
    cookies: Array<{ domain: string; name: string; path?: string; secure?: boolean }>
  ) => {
    const removed: string[] = []
    const jar = {
      get: vi.fn(async () => cookies),
      remove: vi.fn(async (url: string, name: string) => {
        removed.push(`${url}|${name}`)
      })
    }
    return { jar, removed }
  }

  it('removes the Google cookies and nothing else', async () => {
    const { jar, removed } = jarOf([
      { domain: '.google.com', name: 'SID', path: '/' },
      { domain: '.accounts.google.com', name: 'LSID', path: '/' },
      { domain: '.chatgpt.com', name: '__Secure-next-auth', path: '/' }
    ])

    expect(await clearGoogleSessionCookies(jar)).toBe(2)
    expect(removed).toEqual([
      'https://google.com/|SID',
      'https://accounts.google.com/|LSID'
    ])
  })

  it('builds the URL from the cookie, not from a guess', async () => {
    const { jar, removed } = jarOf([
      { domain: '.google.com', name: 'A', path: '/accounts', secure: true },
      { domain: '.google.com', name: 'B', path: '/intl', secure: false }
    ])
    await clearGoogleSessionCookies(jar)
    expect(removed).toEqual([
      'https://google.com/accounts|A',
      'http://google.com/intl|B'
    ])
  })

  it('counts what it removed, and keeps going past one that refuses', async () => {
    let call = 0
    const jar = {
      get: vi.fn(async () => [
        { domain: '.google.com', name: 'SID' },
        { domain: '.google.com', name: 'STICKY' },
        { domain: '.youtube.com', name: 'SAPISID' }
      ]),
      remove: vi.fn(async () => {
        call += 1
        if (call === 2) throw new Error('locked')
      })
    }
    expect(await clearGoogleSessionCookies(jar)).toBe(2)
    expect(jar.remove).toHaveBeenCalledTimes(3)
  })

  it('reports zero for a profile that was not signed in', async () => {
    const { jar } = jarOf([{ domain: '.claude.ai', name: 'sessionKey' }])
    expect(await clearGoogleSessionCookies(jar)).toBe(0)
  })
})
