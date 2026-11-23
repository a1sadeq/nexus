import { app } from 'electron'

/**
 * Electron's own, unmodified user agent — captured before Nexus replaces the global fallback.
 *
 * Nexus replaces `app.userAgentFallback` with a Chrome-shaped string (no `Electron/` token, no app
 * token) so ordinary sites treat it as a normal browser. That is the right default and it stays the
 * default for AI tabs.
 *
 * It is the *wrong* identity for a Google sign-in page. Google's sign-in checks do not reject an app
 * for admitting it is an app: they reject a Chromium that claims to be plain Chrome. Measured on a
 * controlled set of identities in other Electron apps, a laundered `Chrome/... Safari/...` string is
 * refused with "This browser or app may not be secure", while the untouched Electron UA — with its
 * `Electron/` and app tokens — reaches the password page every time. Forged `sec-ch-ua` client hints
 * make no difference either way; what matters is that the header, `navigator.userAgent` and
 * `navigator.userAgentData` all describe the same browser.
 *
 * So the sign-in window presents this string for its whole lifetime: one identity, fixed before the
 * first navigation, no per-host switching and nothing rewritten mid-session.
 */

export function sanitiseProductToken(name: string): string {
  return (name || 'Nexus').replace(/\s+/g, '-').replace(/[^\x20-\x7e]/g, '')
}

export function platformToken(platform: string, arch: string): string {
  if (platform === 'win32') return 'Windows NT 10.0; Win64; x64'
  if (platform === 'linux') return arch === 'arm64' ? 'X11; Linux aarch64' : 'X11; Linux x86_64'
  return 'Macintosh; Intel Mac OS X 10_15_7'
}

/** Chromium's own shape, with the product and Electron tokens left in place. */
export function nativeUserAgent(params: {
  platform: string
  arch: string
  chromium: string
  electron: string
  appName: string
  appVersion: string
}): string {
  const { platform, arch, chromium, electron, appName, appVersion } = params
  const product = sanitiseProductToken(appName)
  return (
    `Mozilla/5.0 (${platformToken(platform, arch)}) AppleWebKit/537.36 (KHTML, like Gecko) ` +
    `${product}/${appVersion || '0.0.0'} Chrome/${chromium} Electron/${electron} Safari/537.36`
  )
}

function capture(): string {
  const existing = app?.userAgentFallback
  if (typeof existing === 'string' && existing.includes('Chrome/')) return existing
  // Older or unusual builds may not expose a fallback yet; build the same string ourselves.
  return nativeUserAgent({
    platform: process.platform,
    arch: process.arch,
    chromium: process.versions.chrome ?? '0.0.0.0',
    electron: process.versions.electron ?? '0.0.0',
    appName: app?.getName?.() ?? 'Nexus',
    appVersion: app?.getVersion?.() ?? '0.0.0'
  })
}

export const NATIVE_ELECTRON_UA: string = capture()

/** True when the two strings describe the same Chromium build, whatever product tokens they carry. */
export function sameChromiumBuild(a: string, b: string): boolean {
  const v = (ua: string): string => /Chrome\/([\d.]+)/.exec(ua)?.[1] ?? ''
  return v(a) !== '' && v(a) === v(b)
}
