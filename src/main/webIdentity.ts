/**
 * Which browser Nexus claims to be, page by page.
 *
 * The sign-in window taught us the rule the hard way: Google refuses a browser that claims to be Chrome
 * and is not — the laundered user agent gets "This browser or app may not be secure", and on the plain
 * Google pages it produces an endless `www.google.com/?zx=…` redirect instead. It does not refuse a
 * browser that says what it is.
 *
 * So the identity is a function of the *page*, not of the request, and the rule is two lines:
 *
 *   • Google's own properties present the honest Electron identity, because they are the pages that
 *     compare the request header, `navigator.userAgent` and `navigator.userAgentData` and refuse when
 *     they disagree. That is `google.com`, `accounts.google.com`, the consent and YouTube account
 *     pages — all of them.
 *   • An AI provider's own page keeps the Chrome-shaped identity every one of them expects, including
 *     `gemini.google.com`, which is Google-owned but is the product rather than a Google property.
 *     Everything else — any other site — keeps it too.
 *
 * The first version of this module answered "is this URL a sign-in page?" per *request*, which meant a
 * sign-in flow that hops `accounts.google.com → www.google.com → consent.google.com` flipped identity at
 * every hop, and a page's own images could end a sign-in. Now the answer is a pure function of the URL,
 * the switch happens only on a main-frame navigation, and every request of a document inherits the
 * identity that document was loaded with — so nothing can oscillate.
 *
 * The sign-in window is the one permanent holder: it keeps the honest identity for its whole life,
 * whatever it loads.
 */

export type WebIdentity = 'ai' | 'native'

/** The slice of Electron's WebContents this needs, so the registry can be tested without Electron. */
export interface IdentityWebContents {
  id: number
  setUserAgent(userAgent: string): void
  isDestroyed(): boolean
}

const permanent = new Set<number>()
/** Pages currently presenting the honest identity. Membership is what the request hook reads. */
const nativeNow = new Set<number>()

let providerHosts: string[] = []
let userAgentFor: (identity: WebIdentity) => string = () => ''

/**
 * The two user agents and the provider hosts are injected rather than imported, so this module stays
 * free of Electron and of the provider configuration. index.ts calls both once, at start-up.
 */
export function configureUserAgents(agents: Record<WebIdentity, string>): void {
  userAgentFor = (identity) => agents[identity]
}

export function configureProviderHosts(hosts: string[]): void {
  providerHosts = hosts
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean)
    .map((host) => host.replace(/^https?:\/\//, '').replace(/\/.*$/, ''))
}

/** Is this hostname an AI provider's own site (including its subdomains)? */
export function isProviderHost(hostname: string): boolean {
  const host = hostname.toLowerCase()
  return providerHosts.some((entry) => host === entry || host.endsWith('.' + entry))
}

/**
 * Is this one of Google's own properties? Every `google.com` and `youtube.com` host counts: the
 * sign-in flow hops between them (`accounts.google.com`, `www.google.com`, `consent.google.com`,
 * `accounts.youtube.com`) and each hop has to look like the same browser as the last.
 */
export function isGoogleOwnedUrl(raw: string | undefined): boolean {
  if (!raw) return false
  try {
    const url = new URL(raw)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return false
    const host = url.hostname.toLowerCase()
    return isUnder(host, 'google.com') || isUnder(host, 'youtube.com') || host === 'youtu.be'
  } catch {
    return false
  }
}

function isUnder(host: string, domain: string): boolean {
  return host === domain || host.endsWith('.' + domain)
}

/** Bare hostname of a URL, or '' when it has none. */
export function hostOf(raw: string | undefined): string {
  if (!raw) return ''
  try {
    return new URL(raw).hostname.toLowerCase()
  } catch {
    return ''
  }
}

/**
 * The identity this page must present. Pure: same URL in, same answer out, which is what makes an
 * oscillating identity impossible.
 */
export function desiredIdentityFor(url: string | undefined): WebIdentity {
  const host = hostOf(url)
  if (!host) return 'ai'
  if (isProviderHost(host)) return 'ai'
  if (isGoogleOwnedUrl(url)) return 'native'
  return 'ai'
}

/** Why a page got the identity it got — for the console line, so a report names the rule it hit. */
export function identityReason(url: string | undefined): string {
  const host = hostOf(url)
  if (!host) return 'no host'
  if (isProviderHost(host)) return `${host} is an AI provider`
  if (isGoogleOwnedUrl(url)) return `${host} is a Google property`
  return `${host} is not Google's`
}

/**
 * Takes on the honest identity. `permanent` is for the sign-in window; everything else follows its URL.
 */
export function adoptNativeIdentity(
  contents: IdentityWebContents | null | undefined,
  userAgent: string,
  options: { permanent?: boolean } = {}
): boolean {
  if (!contents || contents.isDestroyed()) return false
  contents.setUserAgent(userAgent)
  nativeNow.add(contents.id)
  if (options.permanent) permanent.add(contents.id)
  return true
}

/**
 * Back to the Chrome-shaped identity. Returns false for a permanent holder: the sign-in window keeps
 * its identity until it closes, and nothing else is allowed to take it away.
 */
export function releaseNativeIdentity(contents: IdentityWebContents | null | undefined): boolean {
  if (!contents || !nativeNow.has(contents.id)) return false
  if (permanent.has(contents.id)) return false
  nativeNow.delete(contents.id)
  const ua = userAgentFor('ai')
  // Never write an empty string onto a live page: an unconfigured registry is a no-op, not a wipe.
  if (ua && !contents.isDestroyed()) contents.setUserAgent(ua)
  return true
}

/**
 * Puts a page on the identity its URL calls for, and says which one it ended up with. Called from the
 * app-wide `did-navigate` watcher and from the request hook, so both agree by construction.
 */
export function syncIdentity(
  contents: IdentityWebContents | null | undefined,
  url: string | undefined,
  options: { permanent?: boolean } = {}
): WebIdentity {
  if (!contents) return 'ai'
  // Structural registry changes need a live page; the answer for a dead one is whatever it had.
  if (contents.isDestroyed()) return hasNativeIdentity(contents.id) ? 'native' : 'ai'
  if (options.permanent) {
    if (!nativeNow.has(contents.id)) adoptNativeIdentity(contents, userAgentFor('native'), { permanent: true })
    return 'native'
  }
  const desired = desiredIdentityFor(url)
  if (desired === 'native') {
    if (!nativeNow.has(contents.id)) adoptNativeIdentity(contents, userAgentFor('native'))
    return 'native'
  }
  releaseNativeIdentity(contents)
  return 'ai'
}

/**
 * What a request should present, and whether the page behind it has to be switched first.
 *
 * `adopt` is the important half: when the answer is 'native' for a document that is not switched yet,
 * the caller must set the user agent *now*, before the response becomes a document, or the header and `navigator.userAgent` would disagree — which is exactly the state Google refuses.
 *
 * Sub-resources never switch anything: they inherit the identity of the document that is loading them,
 * so a provider page pulling an image from a Google host cannot re-identify the page around it.
 */
export function resolveIdentityForRequest(input: {
  url: string | undefined
  isMainFrame: boolean
  webContentsId: number | undefined
}): { identity: WebIdentity; adopt: boolean; release: boolean } {
  const id = input.webContentsId
  const isNative = id !== undefined && id >= 0 && nativeNow.has(id)

  if (!input.isMainFrame) {
    return { identity: isNative ? 'native' : 'ai', adopt: false, release: false }
  }

  const desired: WebIdentity = hasPermanentNativeIdentity(id)
    ? 'native'
    : desiredIdentityFor(input.url)

  return {
    identity: desired,
    adopt: desired === 'native' && !isNative && id !== undefined && id >= 0,
    release: desired === 'ai' && isNative && !hasPermanentNativeIdentity(id)
  }
}

/** Is this webContents presenting the honest identity right now? */
export function hasNativeIdentity(webContentsId: number | undefined): boolean {
  if (webContentsId === undefined || webContentsId < 0) return false
  return nativeNow.has(webContentsId)
}

/** Is it the sign-in window itself, rather than a page that merely took the identity on? */
export function hasPermanentNativeIdentity(webContentsId: number | undefined): boolean {
  if (webContentsId === undefined || webContentsId < 0) return false
  return permanent.has(webContentsId)
}

/** Forgets a webContents that has gone. Wired to 'destroyed' so ids cannot pile up. */
export function forgetNativeIdentity(webContentsId: number | undefined): void {
  if (webContentsId === undefined || webContentsId < 0) return
  permanent.delete(webContentsId)
  nativeNow.delete(webContentsId)
}

/** Test seam: the registry is process-wide, so tests start from a known state. */
export function resetIdentityRegistry(): void {
  permanent.clear()
  nativeNow.clear()
  providerHosts = []
}
