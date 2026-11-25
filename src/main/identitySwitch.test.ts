import { beforeEach, describe, expect, it } from 'vitest'

import { applyUserAgentOverCdp, type SwitchableContents } from './identitySwitch'
import {
  hasNativeIdentity,
  markChromeIdentity,
  markNativeIdentity,
  resetIdentityRegistry,
  type IdentityWebContents
} from './webIdentity'

const NATIVE_UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Nexus/1.1.0 Chrome/140.0 Electron/38.0 Safari/537.36'
const AI_UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36'

interface FakePage extends SwitchableContents {
  /** How many times the protocol was attached — it must happen once, not per request. */
  attaches: number
  /** Every command the page was given. */
  sent: Array<[string, Record<string, unknown> | undefined]>
  attached: boolean
}

/**
 * A page with the two methods the switch needs, and a record of what it was asked to do. Hand-rolled
 * rather than mocked so the shape is exactly `SwitchableContents`: what this module must never do is
 * call the one API that discards a pending navigation, and a stub cannot hide that.
 */
function fakePage(
  options: { destroyed?: boolean; attachThrows?: boolean; alreadyAttached?: boolean; sendRejects?: boolean } = {}
): FakePage {
  const page: FakePage = {
    attaches: 0,
    sent: [],
    attached: options.alreadyAttached === true,
    isDestroyed: () => options.destroyed === true,
    debugger: {
      isAttached: () => page.attached,
      attach: () => {
        if (options.attachThrows) throw new Error('Another debugger is already attached to this page')
        page.attaches += 1
        page.attached = true
      },
      sendCommand: (method, params) => {
        page.sent.push([method, params])
        return options.sendRejects ? Promise.reject(new Error('Target closed')) : Promise.resolve({})
      }
    }
  }
  return page
}

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

describe('applyUserAgentOverCdp — a switch that does not cancel the navigation', () => {
  it('attaches the protocol once and asks for the identity, not a reload', async () => {
    const page = fakePage()
    expect(applyUserAgentOverCdp(page, NATIVE_UA)).toBe(true)
    await flush()
    expect(page.attaches).toBe(1)
    expect(page.sent).toEqual([['Emulation.setUserAgentOverride', { userAgent: NATIVE_UA }]])
  })

  it('reuses an attached debugger instead of fighting it', async () => {
    const page = fakePage({ alreadyAttached: true })
    expect(applyUserAgentOverCdp(page, AI_UA)).toBe(true)
    await flush()
    expect(page.attaches).toBe(0)
    expect(page.sent[0]?.[1]).toEqual({ userAgent: AI_UA })
  })

  it('says no, and touches nothing, when there is no debugger to use', () => {
    const said: string[] = []
    const page = fakePage({ attachThrows: true })
    expect(applyUserAgentOverCdp(page, NATIVE_UA, (message) => said.push(message))).toBe(false)
    expect(page.sent).toEqual([])
    expect(said.join(' ')).toContain('no debugger')
  })

  it('says no for a page that has gone, and for an empty user agent', () => {
    expect(applyUserAgentOverCdp(fakePage({ destroyed: true }), NATIVE_UA)).toBe(false)
    expect(applyUserAgentOverCdp(fakePage(), '')).toBe(false)
    expect(applyUserAgentOverCdp(null, NATIVE_UA)).toBe(false)
    expect(applyUserAgentOverCdp(undefined, NATIVE_UA)).toBe(false)
  })

  it('reports a failed command without throwing into the request hook', async () => {
    const said: string[] = []
    const page = fakePage({ sendRejects: true })
    expect(applyUserAgentOverCdp(page, NATIVE_UA, (message) => said.push(message))).toBe(true)
    await flush()
    expect(said.join(' ')).toContain('could not override')
  })
})

describe('the registry half of a mid-navigation switch', () => {
  beforeEach(() => resetIdentityRegistry())

  it('records the identity without writing a user agent onto the page', () => {
    const contents = markingPage(31)
    expect(markNativeIdentity(contents)).toBe(true)
    expect(hasNativeIdentity(31)).toBe(true)
    // The registry says native; the page was not touched. `setUserAgent` is what aborts a navigation,
    // so a marking helper that reached for it would undo the whole point.
    expect(contents.userAgents).toEqual([])
  })

  it('gives the identity back for a page that leaves Google', () => {
    const contents = markingPage(32)
    markNativeIdentity(contents)
    expect(markChromeIdentity(contents)).toBe(true)
    expect(hasNativeIdentity(32)).toBe(false)
    // Idempotent: releasing twice is not an error.
    expect(markChromeIdentity(contents)).toBe(true)
    expect(contents.userAgents).toEqual([])
  })

  it('refuses to mark a page that has gone, or nothing at all', () => {
    expect(markNativeIdentity(markingPage(33, { destroyed: true }))).toBe(false)
    expect(markNativeIdentity(null)).toBe(false)
    expect(markChromeIdentity(null)).toBe(false)
    expect(hasNativeIdentity(33)).toBe(false)
  })
})

/**
 * A page for the registry helpers: they only need an id and liveness. `userAgents` stays empty so a test
 * can prove the marking helpers never write to the page.
 */
function markingPage(
  id: number,
  { destroyed = false } = {}
): IdentityWebContents & { userAgents: string[] } {
  const contents = {
    id,
    userAgents: [] as string[],
    setUserAgent(agent: string) {
      contents.userAgents.push(agent)
    },
    isDestroyed: () => destroyed
  }
  return contents
}
