import { createHash } from 'node:crypto'
import { Notification, dialog, type WebContentsView } from 'electron'
import { detectProfiles, readBrowserCookies, type BrowserCookie, type BrowserProfile } from './cookieImport'
import { hasGoogleSessionInNexus, injectCookies } from './googleAuth'
import { isProviderLoginWall, shouldAutoRecoverFromBrowser, ReloadGuard } from './loginWall'

const SID = new Set(['SID', '__Secure-1PSID', '__Secure-3PSID'])
const nowSeconds = () => Date.now() / 1000
export function isGoogleLoginRecoveryUrl(raw: string): boolean {
  // Deliberately *only* provider walls. Google's own sign-in page is not a recovery trigger: reloading
  // the login page after finding a session reloads the login page, which navigates, which recovers.
  return isProviderLoginWall(raw)
}
function authCookies(cookies: BrowserCookie[]) {
  return cookies.filter(c => SID.has(c.name) && c.value && /(^|\.)google\./i.test(c.domain.replace(/^\./,'')) && (!c.expirationDate || c.expirationDate > nowSeconds()))
}
function fingerprint(cookies: BrowserCookie[]) {
  const canonical = authCookies(cookies).map(c => [c.name,c.domain.replace(/^\./,'').toLowerCase(),c.path,c.value,c.expirationDate ?? 0]).sort((a,b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex')
}
export async function findLatestUsableGoogleSession(): Promise<{ profile: BrowserProfile; cookies: BrowserCookie[]; fingerprint: string } | null> {
  const candidates: { profile: BrowserProfile; cookies: BrowserCookie[]; auth: BrowserCookie[] }[] = []
  for (const profile of detectProfiles().filter(p => p.hasGoogleAuth)) {
    try { const cookies = await readBrowserCookies(profile, 'google'); const auth = authCookies(cookies); if(auth.length) candidates.push({profile,cookies,auth}) }
    catch (error) { console.warn(`[google-recovery] Could not read ${profile.name}:`, error instanceof Error ? error.message : String(error)) }
  }
  candidates.sort((a,b) => Math.max(0,...b.auth.map(c=>c.lastAccessed ?? 0)) - Math.max(0,...a.auth.map(c=>c.lastAccessed ?? 0)) || Number(Boolean(b.profile.isLatest))-Number(Boolean(a.profile.isLatest)) || (b.profile.lastAccessed ?? 0)-(a.profile.lastAccessed ?? 0) || a.profile.id.localeCompare(b.profile.id))
  const best = candidates[0]
  return best ? { profile: best.profile, cookies: best.cookies, fingerprint: fingerprint(best.cookies) } : null
}

let inFlight: Promise<void> | null = null
const attempted = new Map<string,string>()
const boundProfiles = new Map<string,string>()
/** One shared budget across both reload paths below; see loginWall.ts for why it exists. */
export const reloadGuard = new ReloadGuard()
export function bindNexusGoogleProfile(tabId: string, profileId: string) { boundProfiles.set(tabId,profileId) }

/** The one place recovery is allowed to reload a view, with the budget applied first. */
function guardedReload(tabId: string, view: WebContentsView, url: string, why: string): boolean {
  if (view.webContents.isDestroyed()) return false
  if (view.webContents.isLoading()) {
    console.log(`[google-recovery] no reload (${why}): view is still loading`)
    return false
  }
  const decision = reloadGuard.shouldReload(tabId, url)
  if (!decision.allow) {
    console.log(`[google-recovery] no reload (${why}): ${decision.reason}`)
    return false
  }
  reloadGuard.record(tabId, url)
  console.log(`[google-recovery] reload (${why}) ${url}`)
  view.webContents.reload()
  return true
}

export async function recoverGoogleSessionFromLatestBrowser(
  tabId: string,
  view: WebContentsView,
  url: string = view.webContents.getURL(),
  accountId: string = 'default'
): Promise<void> {
  if (!shouldAutoRecoverFromBrowser(url)) {
    // The user is on Google's sign-in page (or anywhere else that is not a provider wall). Leave it
    // alone: that page is where they sign in, and reloading it is what made tabs refresh forever.
    console.log(`[google-recovery] skipped: not a provider login wall (${url})`)
    return
  }
  if (inFlight) return inFlight
  inFlight = (async () => {
    const status = (message: string) => { if(Notification.isSupported()) new Notification({title:'Nexus Google session',body:message}).show() }
    try {
      // A session created inside Nexus is already in this partition, and reading another browser's
      // cookie file is impossible for Chrome and Edge on Windows. Check ourselves first.
      // Ask about *this tab's* account: in a container, "signed in" means signed in there, not in the
      // default store.
      if (await hasGoogleSessionInNexus(accountId)) {
        if (guardedReload(tabId, view, url, 'session already in Nexus')) {
          status('Nexus already holds a Google session; reloading the page.')
        } else {
          status('Nexus holds a Google session for this account, but the page was not reloaded again.')
        }
        return
      }
      status('Looking for a recent browser session…')
      const latest = await findLatestUsableGoogleSession()
      if (!latest) { status('No usable browser Google session was found. Sign in manually.'); return }
      const key = `${tabId}:${latest.profile.id}`
      if (attempted.get(key) === latest.fingerprint) { status('This browser session was already tried. Sign in again in the browser or choose a profile manually.'); return }
      const bound = boundProfiles.get(tabId)
      if (bound && bound !== latest.profile.id) {
        const result = await dialog.showMessageBox({type:'question',buttons:['Cancel',`Use ${latest.profile.name}`],defaultId:0,cancelId:0,title:'Restore a different Google profile?',message:`Nexus found a newer Google session in ${latest.profile.name}. This may change the signed-in account.`})
        if(result.response!==1)return
      }
      attempted.set(key,latest.fingerprint)
      status(`Restoring Google session from ${latest.profile.name}…`)
      const result = await injectCookies(latest.cookies)
      if(result.importedGoogleAuthCount<=0 || result.flushError) throw new Error(result.flushError || 'No Google authentication cookies were imported')
      bindNexusGoogleProfile(tabId,latest.profile.id)
      guardedReload(tabId, view, url, `restored from ${latest.profile.name}`)
      status(`Google session restored from ${latest.profile.name}.`)
    } catch(error) { console.error('[google-recovery] Failed:',error); status('Automatic Google session recovery failed. Use manual profile import or sign in.') }
    finally { inFlight=null }
  })()
  return inFlight
}
