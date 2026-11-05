// Google Sign-In for Nexus: system-browser cookie import.
//
// Google rejects sign-in inside embedded Chromium (the Electron TLS stack
// fingerprints differently from real Chrome — "This browser or app may not be
// secure"). Instead of fighting the fingerprint, the system browser does the
// login and the app imports the resulting session cookies into the AI webview
// partition via the documented session.cookies.set() API (no DB writes, no
// partition corruption).
import { shell, session } from 'electron'
import {
  detectDefaultBrowser,
  detectProfiles,
  pickBestProfile,
  readBrowserCookies,
  verifyGoogleSession,
  parseCookieEditorJson,
  normalizeExpirationDate,
  type BrowserCookie
} from './cookieImport'

const POLL_INTERVAL_MS = 2000
const POLL_TIMEOUT_MS = 180_000

export type GoogleSignInEvent =
  | { stage: 'opening-browser' }
  | { stage: 'waiting' }
  | { stage: 'success'; email?: string }
  | { stage: 'error'; message: string }
  | { stage: 'keyring-error'; message: string }
  | {
      stage: 'no-auth'
      profiles: Array<{
        id: string
        browser: string
        name: string
        hasGoogleAuth: boolean
        lastAccessed?: number
        isLatest?: boolean
      }>
    }

type EventSink = (ev: GoogleSignInEvent) => void

let pollTimer: ReturnType<typeof setInterval> | null = null

export function isGoogleSignInUrl(url: string): boolean {
  return url.startsWith('https://accounts.google.com/')
}

export function listProfiles(): Array<{
  id: string
  browser: string
  name: string
  hasGoogleAuth: boolean
  detectedAiSessions: string[]
  lastAccessed?: number
  isLatest?: boolean
  isLocked?: boolean
}> {
  const all = detectProfiles()
  all.sort((a, b) => {
    const aCount = (a.detectedAiSessions?.length ?? 0) + (a.hasGoogleAuth ? 1 : 0)
    const bCount = (b.detectedAiSessions?.length ?? 0) + (b.hasGoogleAuth ? 1 : 0)
    if (bCount !== aCount) return bCount - aCount
    return (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0)
  })
  if (all.length > 0) {
    all[0].isLatest = true
  }
  return all.map((p) => ({
    id: p.id,
    browser: p.browser,
    name: p.name,
    hasGoogleAuth: !!p.hasGoogleAuth,
    detectedAiSessions: p.detectedAiSessions || [],
    lastAccessed: p.lastAccessed,
    isLatest: !!p.isLatest,
    isLocked: !!p.isLocked
  }))
}

export async function clearAiSessionStorage(): Promise<void> {
  const sess = session.fromPartition('persist:ai-shared')
  try {
    await sess.clearStorageData({
      storages: ['cookies', 'cachestorage', 'shadercache']
    })
    await sess.clearCache()
    await sess.cookies.flushStore()
  } catch (err) {
    console.warn('[clearAiSessionStorage] Failed to clear partition storage:', err)
  }
}

export async function startGoogleSignIn(
  loginUrl: string,
  opts: { profileId?: string; onEvent: EventSink } = { onEvent: () => {} }
): Promise<void> {
  const { profileId, onEvent } = opts

  onEvent({ stage: 'opening-browser' })
  try {
    await shell.openExternal(loginUrl)
  } catch (err) {
    onEvent({ stage: 'error', message: `Could not launch browser: ${String(err)}` })
    return
  }
  onEvent({ stage: 'waiting' })

  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }

  const started = Date.now()
  pollTimer = setInterval(async () => {
    if (Date.now() - started > POLL_TIMEOUT_MS) {
      if (pollTimer) clearInterval(pollTimer)
      pollTimer = null
      onEvent({ stage: 'no-auth', profiles: listProfiles() })
      return
    }
    const latest = detectProfiles()
    const picked = profileId
      ? latest.find((p) => p.id === profileId) ?? null
      : pickBestProfile(await detectDefaultBrowser(), latest)

    if (picked?.hasGoogleAuth) {
      const cookies = await readBrowserCookies(picked, 'google')
      if (cookies.length > 0) {
        const verified = await verifyGoogleSession(cookies)
        if (verified.ok) {
          if (pollTimer) clearInterval(pollTimer)
          pollTimer = null
          await clearAiSessionStorage()
          await injectCookies(cookies)
          onEvent({ stage: 'success', email: verified.email })
          return
        }
      }
    }
  }, POLL_INTERVAL_MS)
}

export async function importGoogleSessionDirect(
  opts: { profileId?: string; onEvent: EventSink } = { onEvent: () => {} }
): Promise<boolean> {
  const { profileId, onEvent } = opts
  const profiles = detectProfiles()
  const picked = profileId
    ? profiles.find((p) => p.id === profileId) ?? null
    : pickBestProfile(await detectDefaultBrowser(), profiles)

  if (!picked) {
    onEvent({ stage: 'no-auth', profiles: listProfiles() })
    return false
  }

  onEvent({ stage: 'waiting' })
  const cookies = await readBrowserCookies(picked, 'google')
  if (cookies.length === 0) {
    onEvent({ stage: 'error', message: `No cookies found in profile "${picked.name}".` })
    return false
  }

  await clearAiSessionStorage()
  const res = await injectCookies(cookies)
  if (res.count === 0) {
    onEvent({ stage: 'error', message: 'Failed to inject cookies into session.' })
    return false
  }

  const verified = await verifyGoogleSession(cookies)
  if (verified.ok) {
    onEvent({ stage: 'success', email: verified.email })
    return true
  }

  onEvent({
    stage: 'error',
    message: `Session from "${picked.name}" is expired or unverified. Please log in using the browser button.`
  })
  return false
}

export function cancelGoogleSignIn(): void {
  if (pollTimer) clearInterval(pollTimer)
  pollTimer = null
}

export async function injectCookies(
  cookies: BrowserCookie[]
): Promise<{ count: number; errorCount: number }> {
  const sess = session.fromPartition('persist:ai-shared')
  let count = 0
  let errorCount = 0

  for (const c of cookies) {
    const cleanDomain = c.domain.replace(/^\./, '')
    const isHostCookie = c.name.startsWith('__Host-')
    const isSecureCookie = c.name.startsWith('__Secure-') || isHostCookie || c.secure
    const scheme = 'https'
    const cookiePath = isHostCookie ? '/' : (c.path || '/')
    const url = `${scheme}://${cleanDomain}${cookiePath}`

    try {
      await sess.cookies.remove(url, c.name)
    } catch {
      // cookie absent — nothing to remove
    }

    const expSec = normalizeExpirationDate(c.expirationDate)

    let sameSite: 'unspecified' | 'no_restriction' | 'lax' | 'strict' | undefined = undefined
    if (typeof c.sameSite === 'string') {
      const lower = c.sameSite.toLowerCase()
      if (lower === 'no_restriction' || lower === 'none') sameSite = 'no_restriction'
      else if (lower === 'lax') sameSite = 'lax'
      else if (lower === 'strict') sameSite = 'strict'
      else if (lower === 'unspecified') sameSite = 'unspecified'
    }
    // In Chromium, sameSite: no_restriction requires secure: true
    if (sameSite === 'no_restriction' && !isSecureCookie) {
      sameSite = undefined
    }

    const cookieDetails: Electron.CookiesSetDetails = {
      url,
      name: c.name,
      value: c.value,
      path: cookiePath,
      secure: isSecureCookie,
      httpOnly: c.httpOnly,
      expirationDate: expSec && expSec > Date.now() / 1000 ? expSec : undefined
    }

    if (sameSite) {
      cookieDetails.sameSite = sameSite
    }

    // __Host- cookies MUST NOT have domain property per RFC 6265bis.
    // For domain cookies (original domain started with dot e.g. .google.com), set domain.
    // For host-only cookies (no leading dot e.g. accounts.google.com), omit domain.
    if (!isHostCookie && c.domain.startsWith('.')) {
      cookieDetails.domain = c.domain
    }

    try {
      await sess.cookies.set(cookieDetails)
      count++
    } catch {
      // Fallback: set host-only cookie without explicit domain
      try {
        await sess.cookies.set({
          url,
          name: c.name,
          value: c.value,
          path: cookiePath,
          secure: isSecureCookie,
          httpOnly: c.httpOnly,
          expirationDate: expSec && expSec > Date.now() / 1000 ? expSec : undefined
        })
        count++
      } catch (err) {
        console.warn(`[injectCookies] Failed to set cookie ${c.name} on ${url}:`, err)
        errorCount++
      }
    }
  }

  try {
    await sess.cookies.flushStore()
  } catch {
    // ignore
  }

  return { count, errorCount }
}

export async function syncAllSessionsFromBrowsers(): Promise<{
  success: boolean
  count: number
  profilesCount: number
  message: string
  detectedProviders?: string[]
}> {
  const profiles = detectProfiles()
  if (profiles.length === 0) {
    return {
      success: false,
      count: 0,
      profilesCount: 0,
      message: 'No supported browser profiles detected on this system.'
    }
  }

  // Target profiles that have any detected AI sessions
  const candidates = profiles.filter((p) => (p.detectedAiSessions?.length ?? 0) > 0 || p.hasGoogleAuth)
  const targetProfiles = candidates.length > 0 ? candidates : [profiles[0]]

  let totalCount = 0
  let successfulProfiles = 0
  const allDetected = new Set<string>()

  for (const profile of targetProfiles) {
    try {
      const cookies = await readBrowserCookies(profile, 'all')
      if (cookies.length > 0) {
        // Safe Merge: preserve existing sessions in Nexus, only add/update imported cookies
        const { count } = await injectCookies(cookies)
        if (count > 0) {
          totalCount += count
          successfulProfiles++
          if (profile.detectedAiSessions) {
            for (const s of profile.detectedAiSessions) allDetected.add(s)
          }
        }
      }
    } catch (err) {
      console.warn(`[syncAllSessions] Failed to read cookies from profile ${profile.name}:`, err)
    }
  }

  if (totalCount > 0) {
    return {
      success: true,
      count: totalCount,
      profilesCount: successfulProfiles,
      detectedProviders: Array.from(allDetected),
      message: `Successfully synced ${totalCount} AI session cookie(s) from ${successfulProfiles} profile(s).`
    }
  }

  return {
    success: false,
    count: 0,
    profilesCount: profiles.length,
    message: 'No active AI session cookies found in any installed browser profile.'
  }
}

export async function syncSessionFromProfile(profileId: string): Promise<{
  success: boolean
  count: number
  profileName: string
  message: string
  detectedProviders?: string[]
}> {
  const profiles = detectProfiles()
  const profile = profiles.find((p) => p.id === profileId)
  if (!profile) {
    return {
      success: false,
      count: 0,
      profileName: '',
      message: `Profile "${profileId}" not found.`
    }
  }

  try {
    const cookies = await readBrowserCookies(profile, 'all')
    if (cookies.length === 0) {
      return {
        success: false,
        count: 0,
        profileName: profile.name,
        message: `No active AI session cookies found in "${profile.name}".`
      }
    }

    // Safe Merge: preserve existing sessions in Nexus, only add/update imported cookies
    const { count } = await injectCookies(cookies)
    return {
      success: count > 0,
      count,
      profileName: profile.name,
      detectedProviders: profile.detectedAiSessions,
      message: `Successfully synced ${count} AI session cookie(s) from "${profile.name}".`
    }
  } catch (err: any) {
    const isLocked =
      err?.code === 'EBUSY' ||
      err?.code === 'EPERM' ||
      String(err).toLowerCase().includes('busy') ||
      String(err).toLowerCase().includes('locked')
    return {
      success: false,
      count: 0,
      profileName: profile.name,
      message: isLocked
        ? `Cannot read "${profile.name}" because the browser is currently running. Please close the browser and try again.`
        : `Failed to read cookies from "${profile.name}": ${(err as Error).message}`
    }
  }
}

export async function importCookiesFromJson(jsonStr: string): Promise<{
  success: boolean
  count: number
  message: string
}> {
  try {
    const cookies = parseCookieEditorJson(jsonStr)
    await clearAiSessionStorage()
    const { count } = await injectCookies(cookies)
    return {
      success: count > 0,
      count,
      message: `Successfully applied ${count} session cookie(s) into AI webview partition.`
    }
  } catch (err) {
    return {
      success: false,
      count: 0,
      message: (err as Error).message || 'Failed to parse or inject cookies.'
    }
  }
}
