/**
 * Recognising Google's "this browser or app may not be secure" wall.
 *
 * The page is a dead end: nothing on it can be clicked to a session, and the sign-in window would
 * otherwise sit there until it times out with a message about waiting. Naming it means the card can
 * say what happened instead of implying the user should keep waiting.
 */

export interface PageSnapshot {
  url?: string
  title?: string
  text?: string
}

const REJECTED_URL = /\/signin\/rejected|\/signin\/v\d+\/rejected/i
const UNSECURE_TEXT = /browser or app may not be secure|navigateur ou l'application n'est pas sécuris|no seguro/i
const REJECTED_TITLE = /couldn.t sign you in|impossible de vous connecter/i

export function isGoogleSignInRejection(page: PageSnapshot | null | undefined): boolean {
  if (!page) return false
  const url = page.url ?? ''
  const title = page.title ?? ''
  // The body text is the reliable signal: the URL form has changed more than once, and the heading
  // alone ("Couldn't sign you in") also appears for ordinary wrong-password and no-such-account
  // pages, which are not a browser refusal.
  if (UNSECURE_TEXT.test(page.text ?? '')) return true
  if (REJECTED_URL.test(url)) return true
  return REJECTED_TITLE.test(title) && UNSECURE_TEXT.test(title)
}

export const GOOGLE_REJECTION_MESSAGE =
  'Google refused the sign-in: "This browser or app may not be secure". Nexus now presents its own ' +
  'Electron identity on that page — the one Google accepts — so press Try again in the window. If it ' +
  'is still refused, no browser-side trick will get past it: import the session from Zen, where you ' +
  'are already signed in.'

/** Whether a snapshot came from a Google-hosted page, so a generic page is never misread as a refusal. */
export function isGoogleSignInHost(url: string | undefined): boolean {
  if (!url) return false
  try {
    const host = new URL(url).hostname
    return /(^|\.)google\.com$/.test(host) || /(^|\.)youtube\.com$/.test(host)
  } catch {
    return false
  }
}
