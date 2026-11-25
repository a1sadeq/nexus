import { BrowserWindow } from 'electron'

import { NATIVE_ELECTRON_UA } from './electronIdentity'
import {
  isGoogleSignInHost,
  isGoogleSignInRejection,
  type PageSnapshot
} from './googleSignInBlock'
import { adoptNativeIdentity, forgetNativeIdentity } from './webIdentity'

/**
 * The sign-in window Nexus opens for itself.
 *
 * It loads on the same partition as the AI tabs (`persist:ai-shared`), which is the whole point: the
 * cookies Google sets land in the store the Gemini tab already reads, so there is nothing to export,
 * copy or decrypt afterwards. That matters on Windows, where Chrome and Edge encrypt their cookie
 * files with app-bound encryption ("v20") that cannot be opened from outside the browser — an import
 * from those browsers is not merely awkward there, it is impossible by design.
 *
 * One window at a time: starting a second sign-in closes the first rather than leaving two Google
 * logins open on the same partition.
 *
 * Two things about identity matter here, and both were got wrong at first:
 *
 *  1. The window presents Electron's *own* user agent (see electronIdentity.ts). A Chrome-shaped UA
 *     with the product tokens stripped is precisely what Google's sign-in rejects; the identity that
 *     the page sees in the header, in `navigator.userAgent` and in `navigator.userAgentData` is one
 *     and the same string for the window's whole life.
 *  2. The AI partition's request hook rewrites `User-Agent` on every request in that partition — it
 *     switched this window's header back to the laundered UA no matter what the window said. Requests
 *     from this window are recognised and left on the Electron identity (see webIdentity.ts, where that
 *     same rule now covers every page in the app that lands on Google's sign-in).
 */
export interface InAppSignInHandle {
  /** Closes the window, if it is still open. */
  close: () => void
  /** Resolves when the window is gone, however it went. */
  closed: Promise<void>
}

let current: BrowserWindow | null = null

export function closeInAppSignInWindow(): void {
  if (current && !current.isDestroyed()) current.close()
  current = null
}

export interface InAppSignInOptions {
  /** Which cookie store the sign-in lands in. One partition per Google account. */
  partition: string
  parent?: BrowserWindow | null
  /** Called once per refusal page: Google would not let this window sign in. */
  onBlocked?: (page: PageSnapshot) => void
}

export function openInAppSignInWindow(
  url: string,
  { partition, parent, onBlocked }: InAppSignInOptions
): InAppSignInHandle {
  closeInAppSignInWindow()

  const win = new BrowserWindow({
    width: 560,
    height: 760,
    parent: parent && !parent.isDestroyed() ? parent : undefined,
    modal: false,
    show: true,
    autoHideMenuBar: true,
    title: 'Sign in — Nexus',
    backgroundColor: '#111318',
    webPreferences: {
      // One partition per account. The default account's partition is the one every AI tab uses, so
      // signing into it signs the tabs in; an added account gets its own store, ready for containers.
      partition,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  })
  current = win

  const closed = new Promise<void>((resolve) => {
    win.once('closed', () => {
      if (current === win) current = null
      resolve()
    })
  })

  // Google's flow opens a few popups (account chooser, consent). Keep them in this window instead of
  // spawning windows the user might lose behind it.
  win.webContents.setWindowOpenHandler(({ url: target }) => {
    if (/^https?:/i.test(target)) void win.loadURL(target)
    return { action: 'deny' }
  })

  // The window's own identity, matching what the partition hook above will send. Registered as a
  // *permanent* holder: this window is the one place in the app that must keep the honest Electron
  // identity for its whole life, and nothing that happens to its pages may hand it back.
  //
  // The id is taken now, not in the handler: by the time 'closed' fires the window is destroyed and
  // reading `win.webContents` throws, so a forget that reached for it there would never run.
  const contentsId = win.webContents.id
  adoptNativeIdentity(win.webContents, NATIVE_ELECTRON_UA, { permanent: true })
  win.once('closed', () => forgetNativeIdentity(contentsId))

  // Google's refusal page is rendered server-side and announced in the body text. Report it, but do
  // not close the window: "Try again" on that page is a real retry, and a late success still counts.
  let reportedUrl: string | null = null
  const inspect = async (): Promise<void> => {
    if (win.isDestroyed() || !onBlocked) return
    let page: PageSnapshot | null = null
    try {
      page = (await win.webContents.executeJavaScript(
        `(() => ({ url: location.href, title: document.title, text: (document.body && document.body.innerText || '').slice(0, 4000) }))()`,
        true
      )) as PageSnapshot
    } catch {
      return
    }
    if (!page || !isGoogleSignInHost(page.url) || !isGoogleSignInRejection(page)) return
    const key = `${page.url}|${page.title}`
    if (reportedUrl === key) return
    reportedUrl = key
    onBlocked(page)
  }
  win.webContents.on('did-finish-load', () => void inspect())
  win.webContents.on('did-navigate-in-page', () => void inspect())

  void win.loadURL(url)

  return {
    close: () => {
      if (!win.isDestroyed()) win.close()
    },
    closed
  }
}
