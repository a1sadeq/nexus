import { describe, it, expect } from 'vitest'

import { nativeUserAgent, platformToken, sanitiseProductToken, sameChromiumBuild } from './electronIdentity'

describe('nativeUserAgent', () => {
  const base = {
    platform: 'win32',
    arch: 'x64',
    chromium: '150.0.7871.47',
    electron: '43.8.12',
    appName: 'Nexus',
    appVersion: '1.4.2'
  }

  it('keeps the product and Electron tokens — the identity Google accepts', () => {
    const ua = nativeUserAgent(base)

    expect(ua).toContain('Chrome/150.0.7871.47')
    expect(ua).toContain('Electron/43.8.12')
    expect(ua).toContain('Nexus/1.4.2')
    expect(ua.endsWith('Safari/537.36')).toBe(true)
  })

  it('looks like Chromium, not like a laundered Chrome', () => {
    // The laundered form is exactly "... Chrome/x Safari/537.36" with nothing between them.
    expect(nativeUserAgent(base)).not.toMatch(/Chrome\/[\d.]+ Safari/)
  })

  it('matches the host OS instead of hard-coding one', () => {
    expect(platformToken('win32', 'x64')).toBe('Windows NT 10.0; Win64; x64')
    expect(platformToken('linux', 'x64')).toBe('X11; Linux x86_64')
    expect(platformToken('linux', 'arm64')).toBe('X11; Linux aarch64')
    expect(platformToken('darwin', 'arm64')).toBe('Macintosh; Intel Mac OS X 10_15_7')
  })

  it('never emits a token with a space or an empty product name', () => {
    expect(sanitiseProductToken('My App')).toBe('My-App')
    expect(sanitiseProductToken('')).toBe('Nexus')
    expect(nativeUserAgent({ ...base, appName: 'Some App' })).toContain('Some-App/1.4.2')

    const ua = nativeUserAgent({ ...base, appVersion: '' })
    expect(ua).toContain('Nexus/0.0.0')
  })

  it('agrees with the laundered UA about the Chromium build', () => {
    const laundered = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.7871.47 Safari/537.36'

    expect(sameChromiumBuild(laundered, nativeUserAgent(base))).toBe(true)
    expect(sameChromiumBuild('Chrome/141.0.0.0', nativeUserAgent(base))).toBe(false)
    expect(sameChromiumBuild('Chrome', nativeUserAgent(base))).toBe(false)
  })
})
