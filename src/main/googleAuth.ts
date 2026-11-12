// Session management for Nexus: browser cookie sync and JSON import.
//
// Google authentication is handled via system-browser sign-in flow. The app
// opens accounts.google.com in the user's default browser, then polls the
// local browser profile database to detect when a fresh Google session appears.
// That session is imported into the AI webview partition via session.cookies.set().
import { shell, session } from 'electron'
import {
  detectDefaultBrowser,
  detectProfiles,
  pickBestProfile,
  readBrowserCookies,
  parseCookieEditorJson,
  normalizeExpirationDate,
  mapNumericSameSite,
  validateDomainForCookieImport,
  isGoogleCookieDomain,
  matchAiProvidersFromHost,
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
let pollCallbackRunning = false
let signInGeneration = 0
// Track which generation currently "owns" the running flag so a stale
// callback from an older attempt never resets the state of a newer one.
let pollRunningGeneration = -1

export function cancelGoogleSignIn(): void {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
  signInGeneration++
  // Only reset the running flag when we are still the owning generation.
  // A newer attempt may have already started and claim the flag by the time
  // this runs.
  if (pollRunningGeneration === signInGeneration - 1) {
    pollCallbackRunning = false
    pollRunningGeneration = -1
  }
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

export interface CookieInjectionReport {
  count: number
  errorCount: number
  skippedExpired: number
  skippedInvalid: number
  importedGoogleAuthCount: number
  flushError?: string
  affectedProviders?: string[]
}

let importQueue: Promise<CookieInjectionReport> = Promise.resolve({
  count: 0,
  errorCount: 0,
  skippedExpired: 0,
  skippedInvalid: 0,
  importedGoogleAuthCount: 0,
  affectedProviders: []
})

export async function injectCookies(
  cookies: BrowserCookie[]
): Promise<CookieInjectionReport> {
  const run = importQueue.then(
    () => injectCookiesSerialized(cookies),
    () => injectCookiesSerialized(cookies)
  )
  importQueue = run.then(
    () => ({ count: 0, errorCount: 0, skippedExpired: 0, skippedInvalid: 0, importedGoogleAuthCount: 0, affectedProviders: [] }),
    () => ({ count: 0, errorCount: 0, skippedExpired: 0, skippedInvalid: 0, importedGoogleAuthCount: 0, affectedProviders: [] })
  )
  return run
}

async function injectCookiesSerialized(
  cookies: BrowserCookie[]
): Promise<CookieInjectionReport> {
  const sess = session.fromPartition('persist:ai-shared')
  const successfulDomains = new Set<string>()
  let count = 0
  let errorCount = 0
  let skippedExpired = 0
  let skippedInvalid = 0
  let importedGoogleAuthCount = 0

  for (const c of cookies) {
    // Validate required fields
    if (!c.name || !c.domain) {
      skippedInvalid++
      continue
    }
    const domainValidation = validateDomainForCookieImport(c.domain)
    if (!domainValidation.valid) {
      skippedInvalid++
      continue
    }
    if (!c.value && isRequiredGoogleAuthCookie(c.name)) {
      skippedInvalid++
      continue
    }

    // Normalize domain
    const cleanDomain = c.domain.trim().replace(/^\./, '').replace(/\.$/, '')
    const isHostCookie = c.name.startsWith('__Host-')
    const isSecureCookie = c.secure || c.name.startsWith('__Secure-') || isHostCookie
    const cookiePath = isHostCookie ? '/' : (c.path || '/')
    const url = `https://${cleanDomain}${cookiePath}`

    // Normalize expiration
    const expSec = normalizeExpirationDate(c.expirationDate)
    if (expSec !== undefined && expSec <= Date.now() / 1000) {
      skippedExpired++
      continue
    }

    // Map SameSite
    let sameSite: 'unspecified' | 'no_restriction' | 'lax' | 'strict' | undefined = undefined
    if (typeof c.sameSite === 'number') {
      sameSite = mapNumericSameSite(c.sameSite)
    } else if (typeof c.sameSite === 'string') {
      const lower = c.sameSite.toLowerCase()
      if (lower === 'no_restriction' || lower === 'none') sameSite = 'no_restriction'
      else if (lower === 'lax') sameSite = 'lax'
      else if (lower === 'strict') sameSite = 'strict'
      else if (lower === 'unspecified') sameSite = 'unspecified'
    }

    // no_restriction requires secure
    if (sameSite === 'no_restriction' && !isSecureCookie) {
      sameSite = undefined
    }

    // Build cookie details
    const cookieDetails: Electron.CookiesSetDetails = {
      url,
      name: c.name,
      value: c.value,
      path: cookiePath,
      secure: isSecureCookie,
      httpOnly: Boolean(c.httpOnly)
    }

    if (expSec !== undefined) {
      cookieDetails.expirationDate = expSec
    }

    if (sameSite) {
      cookieDetails.sameSite = sameSite
    }

    if (!isHostCookie && c.domain.trim().startsWith('.')) {
      cookieDetails.domain = `.${cleanDomain}`
    }

    try {
      await sess.cookies.set(cookieDetails)
      count++
      successfulDomains.add(cleanDomain)
      if (
        isGoogleCookieDomain(cleanDomain) &&
        REQUIRED_GOOGLE_AUTH_COOKIES.has(c.name) &&
        c.value &&
        c.value.length > 0
      ) {
        importedGoogleAuthCount++
      }
    } catch {
      errorCount++
    }
  }

  let flushErr: string | undefined = undefined
  try {
    await sess.cookies.flushStore()
  } catch (err) {
    flushErr = err instanceof Error ? err.message : String(err)
    errorCount++
  }

  const affectedProvidersSet = new Set<string>()
  for (const domain of successfulDomains) {
    matchAiProvidersFromHost(domain, affectedProvidersSet)
  }
  // Normalize google → gemini so reloads target Gemini views consistently with viewModelKeys.
  if (affectedProvidersSet.has('google') && !affectedProvidersSet.has('gemini')) {
    affectedProvidersSet.delete('google')
    affectedProvidersSet.add('gemini')
  }

  return {
    count,
    errorCount,
    skippedExpired,
    skippedInvalid,
    importedGoogleAuthCount,
    flushError: flushErr,
    affectedProviders: Array.from(affectedProvidersSet)
  }
}

// Required Google auth cookies that must have nonempty values
const REQUIRED_GOOGLE_AUTH_COOKIES = new Set(['SID', '__Secure-1PSID', '__Secure-3PSID'])
function isRequiredGoogleAuthCookie(name: string): boolean {
  return REQUIRED_GOOGLE_AUTH_COOKIES.has(name)
}

export async function startGoogleSignIn(
  loginUrl: string,
  opts: { profileId?: string; onEvent: EventSink } = { onEvent: () => {} }
): Promise<void> {
  const { profileId, onEvent } = opts
  cancelGoogleSignIn()
  signInGeneration++
  const generation = signInGeneration
  onEvent({ stage: 'opening-browser' })
  try {
    await shell.openExternal(loginUrl)
  } catch (err) {
    if (generation !== signInGeneration) return
    onEvent({ stage: 'error', message: `Could not launch browser: ${String(err)}` })
    return
  }
  onEvent({ stage: 'waiting' })
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
  const started = Date.now()
  // Resolve and retain one profile selection for the whole attempt. Do not
  // silently switch profiles between polls; only this one profile is re-read.
  const latestInitial = detectProfiles()
  let lockedSelectionId: string | null = null
  if (profileId) {
    lockedSelectionId = profileId
  } else {
    const initialPick = pickBestProfile(await detectDefaultBrowser(), latestInitial)
    lockedSelectionId = initialPick?.id ?? null
  }

  pollTimer = setInterval(async () => {
    if (pollCallbackRunning || generation !== signInGeneration) return
    pollCallbackRunning = true
    pollRunningGeneration = generation
    try {
      if (generation !== signInGeneration) return
      if (Date.now() - started > POLL_TIMEOUT_MS) {
        if (pollTimer) clearInterval(pollTimer)
        pollTimer = null
        if (generation === signInGeneration) {
          onEvent({ stage: 'no-auth', profiles: listProfiles() })
        }
        return
      }
      const latest = detectProfiles()
      let picked = lockedSelectionId ? (latest.find((p) => p.id === lockedSelectionId) ?? null) : null
      if (!picked && !lockedSelectionId && !profileId) {
        // First attempt resolution may have found no profile; resolve once now.
        const candidate = pickBestProfile(await detectDefaultBrowser(), latest)
        if (candidate) {
          lockedSelectionId = candidate.id
          picked = candidate
        }
      }
      if (!picked) return
      if (generation !== signInGeneration) return
      if (picked.hasGoogleAuth) {
        const cookies = await readBrowserCookies(picked, 'google')
        if (generation !== signInGeneration) return
        if (cookies.length > 0) {
          const result = await injectCookies(cookies)
          if (generation !== signInGeneration) return
          if (result.importedGoogleAuthCount > 0 && !result.flushError) {
            // A usable SID-family auth cookie was imported durably — success.
            if (pollTimer) clearInterval(pollTimer)
            pollTimer = null
            onEvent({ stage: 'success' })
            return
          }
          // Cookies were read but none carried a usable SID-family auth cookie,
          // or the cookie store flush failed. Keep polling until timeout rather
          // than emitting an unqualified success.
        }
      }
    } catch (err) {
      console.warn('[startGoogleSignIn] Poll callback error:', err)
    } finally {
      // Only release the running flag when this callback still owns it; a newer
      // attempt's finally block may already have taken over and we must not
      // clobber its state.
      if (pollRunningGeneration === generation) {
        pollCallbackRunning = false
        pollRunningGeneration = -1
      }
    }
  }, POLL_INTERVAL_MS)
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
      message: 'No supported browser profiles detected on this system. Google sessions must be imported separately from one selected profile.'
    }
  }

  // Iterate all candidate profiles; exclude individual Google cookies so a mixed
  // profile still contributes its AI session cookies without risking account mixing.
  let totalCount = 0
  let successfulProfiles = 0
  const allDetected = new Set<string>()

  for (const profile of profiles) {
    try {
      const cookies = await readBrowserCookies(profile, 'all')
      const nonGoogleCookies = cookies.filter((c) => !isGoogleCookieDomain(c.domain))
      if (nonGoogleCookies.length > 0) {
        const report = await injectCookies(nonGoogleCookies)
        if (report.count > 0) {
          totalCount += report.count
          successfulProfiles++
          const providers = (report.affectedProviders ?? []).filter(
            (k) => k !== 'google' && k !== 'gemini'
          )
          for (const p of providers) allDetected.add(p)
        }
      }
    } catch (err) {
      console.warn('[syncAllSessions] Failed to read cookies from profile %s:', profile.name, err)
    }
  }

  const googleNote = ' Google sessions must be imported separately from one selected profile.'

  if (totalCount > 0) {
    return {
      success: true,
      count: totalCount,
      profilesCount: successfulProfiles,
      detectedProviders: Array.from(allDetected),
      message: `Successfully synced ${totalCount} AI session cookie(s) from ${successfulProfiles} profile(s).${googleNote}`
    }
  }

  return {
    success: false,
    count: 0,
    profilesCount: profiles.length,
    message: `No active AI session cookies found in any installed browser profile.${googleNote}`
  }
}

export async function syncSessionFromProfile(profileId: string): Promise<{
  success: boolean
  count: number
  profileName: string
  message: string
  detectedProviders?: string[]
  affectedProviders?: string[]
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

    const report = await injectCookies(cookies)
    if (report.count > 0) {
      return {
        success: true,
        count: report.count,
        profileName: profile.name,
        detectedProviders: profile.detectedAiSessions,
        affectedProviders: report.affectedProviders,
        message: `Successfully synced ${report.count} AI session cookie(s) from "${profile.name}".`
      }
    }
    return {
      success: false,
      count: 0,
      profileName: profile.name,
      detectedProviders: profile.detectedAiSessions,
      affectedProviders: report.affectedProviders,
      message: report.errorCount > 0
        ? `Failed to inject ${report.errorCount} cookie(s) from "${profile.name}".`
        : `No valid cookies found in "${profile.name}".`
    }
  } catch (err: unknown) {
    const isLocked =
      (err as Record<string, unknown>)?.code === 'EBUSY' ||
      (err as Record<string, unknown>)?.code === 'EPERM' ||
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
  errorCount: number
  message: string
  affectedProviders?: string[]
}> {
  try {
    const cookies = parseCookieEditorJson(jsonStr)
    const report = await injectCookies(cookies)
    if (report.count > 0) {
      return {
        success: true,
        count: report.count,
        errorCount: report.errorCount,
        affectedProviders: report.affectedProviders,
        message: `Successfully applied ${report.count} session cookie(s) into AI webview partition.`
      }
    }
    return {
      success: false,
      count: 0,
      errorCount: report.errorCount,
      affectedProviders: report.affectedProviders,
      message: report.errorCount > 0
        ? `Failed to inject ${report.errorCount} cookie(s).`
        : 'No valid cookies found in JSON payload.'
    }
  } catch (err) {
    return {
      success: false,
      count: 0,
      errorCount: 0,
      message: (err as Error).message || 'Failed to parse or inject cookies.'
    }
  }
}
