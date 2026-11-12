import type { Session } from 'electron'

const installed = new WeakSet<Session>()
let pending: Session | null = null
let timer: NodeJS.Timeout | null = null

export function isGoogleSessionCookie(domain: string): boolean {
  const host = domain.replace(/^\./, '').toLowerCase()
  return host === 'google.com' || host.endsWith('.google.com')
}

export async function flushGoogleSessionStore(sess: Session): Promise<void> {
  if (timer) clearTimeout(timer)
  timer = null
  if (pending === sess) pending = null
  await sess.cookies.flushStore()
}

export function installGoogleSessionPersistence(sess: Session): () => void {
  if (installed.has(sess)) return () => undefined
  installed.add(sess)
  const changed = (_event: Electron.Event, cookie: Electron.Cookie) => {
    if (!cookie.domain || !isGoogleSessionCookie(cookie.domain)) return
    pending = sess
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      void flushGoogleSessionStore(sess).catch(error => console.error('[google-session] Cookie flush failed:', error))
    }, 850)
  }
  sess.cookies.on('changed', changed)
  return () => { sess.cookies.off('changed', changed); installed.delete(sess) }
}
