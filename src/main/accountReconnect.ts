import type { ContainerRecord } from './containers'

/**
 * Signing one account in again, from the beginning.
 *
 * The ordinary "Sign in" button is additive: it opens the account's own partition, and whatever
 * happens there, the store that is already signed in stays signed in. That is the right default — a
 * stray click must not sign a working profile out — but it is useless for the two things people
 * actually ask for:
 *
 *   • "I signed into the wrong Google account" — the store answers every request with the account it
 *     already holds, so the chooser never appears and cannot be overridden.
 *   • "Add another account to this profile" — same wall, from the other side.
 *
 * So reconnecting is three steps in a fixed order, and the order is the whole point:
 *
 *   1. Sign Google out of that account's store: its cookies, by domain, and the storage
 *      accounts.google.com keeps. Only Google — a profile is also signed into Gemini, ChatGPT or
 *      Claude, and "I picked the wrong Google account" is not a reason to sign the user out of those.
 *      One partition per account is what keeps this bounded: the cookies being removed cannot belong
 *      to anyone else.
 *   2. Reload the tabs that live in the container, so the user sees the sign-out. Reloading after the
 *      sign-in instead would leave a tab looking signed in while the store behind it was already
 *      empty.
 *   3. Open the sign-in window on that partition, with a URL that asks Google for the account
 *      chooser — including "Use another account".
 *
 * Kept apart from Electron so the sequence itself can be tested: dependencies are passed in, and a
 * store that refuses to clear stops the flow before the sign-in window is opened rather than after.
 */

export interface ReconnectTarget {
  containerId: string
  /** For the messages the user reads; never a key. */
  containerName: string
  accountId: string
}

export type ReconnectStage = 'clearing' | 'cleared' | 'signing-in' | 'failed'

export interface ReconnectEvent {
  stage: ReconnectStage
  message?: string
}

export interface ReconnectDeps {
  /** Wipes that account's cookie store. Rejects when it could not be cleared. */
  clearSession: (accountId: string) => Promise<void>
  /** Reloads the container's tabs so the sign-out is visible. */
  reloadContainer: (containerId: string) => void
  /** Opens the sign-in window on that account's partition, at that URL. */
  startSignIn: (accountId: string, url: string) => Promise<void>
  report: (event: ReconnectEvent) => void
}

/**
 * The sign-in URL, asking for the chooser.
 *
 * `passive=true` — what the ordinary sign-in uses — means "sign in silently with the account this
 * store already holds". Starting again is the one case where that is exactly the wrong instruction.
 */
export function signInUrlForFreshLogin(baseUrl: string): string {
  const url = new URL(baseUrl)
  url.searchParams.set('passive', 'false')
  url.searchParams.set('prompt', 'select_account')
  return url.toString()
}

/**
 * Cookies that carry a Google identity. The ccTLD pattern is deliberate: a sign-in on google.co.uk
 * sets `.google.com` cookies today, but nothing guarantees it always will, and a leftover `SID` is a
 * session that comes back.
 */
const GOOGLE_SESSION_DOMAIN_PATTERN =
  /(^|\.)(google\.[a-z]{2,}(\.[a-z]{2,})?|googleusercontent\.com|gstatic\.com|googleapis\.com|youtube\.com|youtu\.be|ytimg\.com)$/i

export function isGoogleSessionCookieDomain(domain: string): boolean {
  const host = String(domain ?? '')
    .trim()
    .toLowerCase()
    .replace(/^\.+/, '')
    .replace(/\.$/, '')
  if (!host) return false
  return GOOGLE_SESSION_DOMAIN_PATTERN.test(host)
}

/**
 * The slice of Electron's cookie API this needs, so the removal can be tested without Electron.
 * `domain` is optional because Electron's own `Cookie.domain` is.
 */
export interface GoogleCookieJar {
  get(filter: { domain?: string }): Promise<
    Array<{ domain?: string; name: string; path?: string; secure?: boolean }>
  >
  remove(url: string, name: string): Promise<void>
}

/**
 * Removes every Google cookie from one partition, and nothing else.
 *
 * Returns how many were taken out, which is what the log line reports — "signed out" claimed after
 * zero removals would be a lie the user would discover on the next reload.
 */
export async function clearGoogleSessionCookies(jar: GoogleCookieJar): Promise<number> {
  const all = await jar.get({})
  let removed = 0
  for (const cookie of all) {
    if (!isGoogleSessionCookieDomain(cookie.domain ?? '')) continue
    const host = (cookie.domain ?? '').replace(/^\.+/, '')
    const scheme = cookie.secure === false ? 'http' : 'https'
    const path = cookie.path && cookie.path.startsWith('/') ? cookie.path : '/'
    try {
      await jar.remove(`${scheme}://${host}${path}`, cookie.name)
      removed += 1
    } catch {
      // A cookie that refuses to go is reported by the count, not by aborting the sign-out.
    }
  }
  return removed
}

/** The container a reconnect is for, with the name the user will read in the messages. */
export function reconnectTargetFor(container: ContainerRecord): ReconnectTarget {
  return {
    containerId: container.id,
    containerName: container.name?.trim() || container.id,
    accountId: container.accountId || 'default'
  }
}

export async function reconnectAccount(
  target: ReconnectTarget,
  deps: ReconnectDeps,
  loginUrl: string
): Promise<{ ok: boolean; error?: string }> {
  deps.report({ stage: 'clearing' })
  try {
    await deps.clearSession(target.accountId)
  } catch (err) {
    // Stop here. A store that would not clear is still holding the old account, so opening the
    // chooser would sign the user straight back into the account they were trying to leave.
    const message = `Could not clear the saved session for ${target.containerName}: ${String(err)}`
    deps.report({ stage: 'failed', message })
    return { ok: false, error: message }
  }

  deps.reloadContainer(target.containerId)
  deps.report({ stage: 'cleared' })

  try {
    await deps.startSignIn(target.accountId, signInUrlForFreshLogin(loginUrl))
  } catch (err) {
    const message = `The session for ${target.containerName} was cleared, but the sign-in window would not open: ${String(err)}`
    deps.report({ stage: 'failed', message })
    return { ok: false, error: message }
  }

  deps.report({ stage: 'signing-in' })
  return { ok: true }
}
