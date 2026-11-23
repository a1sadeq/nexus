/**
 * Which page is which kind of sign-in page, and when a reload is allowed.
 *
 * These two questions used to be one, and the answer was wrong: an AI tab that navigated to
 * `accounts.google.com` counted as "the provider showed a login wall", so Nexus ran its browser-cookie
 * recovery. That recovery reloads the view when a session already exists — on the login page itself,
 * which reloads the login page, which navigates again, which recovers again. The tab refreshed
 * forever.
 *
 * The distinction that matters:
 *
 *   • The user is *on* Google's sign-in page, choosing an account. Nothing should touch it. Signing in
 *     there is the supported route now, and it lands in the tab's own partition.
 *   • An AI provider page is showing a sign-in wall (gemini.google.com/signin and friends). That is
 *     what recovery was written for: import, then reload once so the wall goes away.
 */

/** Google's own sign-in surface: account chooser, consent, challenge pages. */
export function isGoogleSignInPage(raw: string): boolean {
  try {
    const u = new URL(raw)
    if (u.protocol !== 'https:') return false
    const host = u.hostname.toLowerCase()
    if (host === 'accounts.google.com') return true
    // Consent and 2-step pages live on other Google hosts.
    return host === 'accounts.youtube.com' || (host === 'myaccount.google.com' && u.pathname !== '/')
  } catch {
    return false
  }
}

/**
 * Pages that belong to an identity provider rather than to the AI product.
 *
 * Nothing of ours is injected into them — no theme, no aura, no runtime automation, no custom init
 * script. Two reasons: a sign-in page has to look exactly like the sign-in page (people are being
 * asked to type a password into it), and our injected CSS carries infinite animations — the ambient
 * aura drifts and breathes forever. On Google's account chooser those animations played over the
 * chooser itself, which reads as a page that keeps refreshing and glitching.
 */
const AUTH_HOSTS = [
  /^accounts\.google\.com$/,
  /^accounts\.youtube\.com$/,
  /^myaccount\.google\.com$/,
  /^login\.microsoftonline\.com$/,
  /^login\.live\.com$/,
  /^appleid\.apple\.com$/,
  /^github\.com$/,
  /^auth\.openai\.com$/,
  /^sso\./,
  /^login\./
]

export function isThirdPartyAuthPage(raw: string): boolean {
  try {
    const u = new URL(raw)
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return false
    const host = u.hostname.toLowerCase()
    if (AUTH_HOSTS.some((re) => re.test(host))) return true
    // OAuth authorize endpoints on any host.
    return /\/(o\/oauth2|oauth2\/auth|authorize|signin|login)(\/|$)/i.test(u.pathname) &&
      !/(^|\.)(gemini\.google\.com|chatgpt\.com|claude\.ai|arena\.ai)$/.test(host)
  } catch {
    return false
  }
}

const PROVIDER_LOGIN_PATHS: Array<{ host: RegExp; path?: RegExp }> = [
  { host: /(^|\.)gemini\.google\.com$/, path: /^\/(signin|app\/signin)/i },
  { host: /(^|\.)aistudio\.google\.com$/, path: /^\/(login|signin)/i },
  { host: /(^|\.)chatgpt\.com$/, path: /^\/(auth|login)/i },
  { host: /(^|\.)claude\.ai$/, path: /^\/(login|oauth)/i },
  { host: /(^|\.)chat\.deepseek\.com$/, path: /^\/(sign_in|login)/i },
  { host: /(^|\.)perplexity\.ai$/, path: /^\/(login|signin)/i },
  { host: /(^|\.)kimi\.(com|moonshot\.cn)$/, path: /^\/(login|signin)/i },
  { host: /(^|\.)chat\.qwen\.(ai|com)$/, path: /^\/(login|auth)/i }
]

/** An AI provider page showing a sign-in wall — the case recovery can actually help with. */
export function isProviderLoginWall(raw: string): boolean {
  try {
    const u = new URL(raw)
    if (u.protocol !== 'https:') return false
    const host = u.hostname.toLowerCase()
    if (isGoogleSignInPage(raw)) return false
    for (const rule of PROVIDER_LOGIN_PATHS) {
      if (!rule.host.test(host)) continue
      if (!rule.path) return true
      if (rule.path.test(u.pathname)) return true
    }
    return false
  } catch {
    return false
  }
}

/** Should Nexus reach for another browser's cookies at all, for this page? */
export function shouldAutoRecoverFromBrowser(raw: string): boolean {
  return isProviderLoginWall(raw)
}

export interface ReloadDecision {
  allow: boolean
  reason?: string
}

/**
 * A reload budget per tab, so a mistake in any caller cannot turn into a refresh loop.
 *
 * Same URL again inside the cooldown: refused. More reloads than the budget: refused for the rest of
 * the session, with a reason, rather than silently spinning.
 */
export class ReloadGuard {
  private readonly state = new Map<string, { lastUrl: string; lastAt: number; total: number }>()

  constructor(
    private readonly maxReloads = 3,
    private readonly cooldownMs = 10 * 60_000
  ) {}

  shouldReload(tabId: string, url: string, now: number = Date.now()): ReloadDecision {
    const entry = this.state.get(tabId)
    if (!entry) return { allow: true }
    if (entry.total >= this.maxReloads) {
      return { allow: false, reason: `${entry.total} reloads already used for this tab` }
    }
    if (entry.lastUrl === url && now - entry.lastAt < this.cooldownMs) {
      return { allow: false, reason: 'this exact URL was reloaded moments ago' }
    }
    return { allow: true }
  }

  record(tabId: string, url: string, now: number = Date.now()): void {
    const entry = this.state.get(tabId)
    if (!entry) {
      this.state.set(tabId, { lastUrl: url, lastAt: now, total: 1 })
      return
    }
    entry.lastUrl = url
    entry.lastAt = now
    entry.total += 1
  }

  /** Called when the user closes a tab, so the map does not grow for the life of the app. */
  forget(tabId: string): void {
    this.state.delete(tabId)
  }

  stats(tabId: string): { total: number; lastUrl: string; lastAt: number } | null {
    const entry = this.state.get(tabId)
    return entry ? { ...entry } : null
  }
}
