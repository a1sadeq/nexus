import type { WebContents } from 'electron'
import { createHash } from 'crypto'

// Weak ownership: destroyed tabs do not remain strongly referenced by these maps.
const epochs = new WeakMap<WebContents, { value: number }>()
const busy = new WeakSet<WebContents>()
export function hookContextId(contents: WebContents): string {
  let state = epochs.get(contents)
  if (!state) {
    state = { value: 0 }
    epochs.set(contents, state)
    const current = state
    contents.on('did-start-navigation', (_e, _url, _inPlace, mainFrame) => { if (mainFrame) current.value++ })
    contents.on('did-navigate-in-page', (_e, _url, mainFrame) => { if (mainFrame) current.value++ })
    contents.on('render-process-gone', () => { current.value++ })
  }
  return `${contents.id}:${state.value}:${createHash('sha256').update(contents.getURL()).digest('hex').slice(0, 16)}`
}

/** Timeout bounds host waiting, NOT Chromium execution; keep the busy guard until execution settles. */
export async function executeHookCapture(contents: WebContents, script: string, timeoutMs = 5000): Promise<unknown> {
  if (busy.has(contents)) throw new Error('capture_in_progress')
  busy.add(contents)
  let timer: ReturnType<typeof setTimeout> | undefined
  const execution = Promise.resolve().then(() => contents.executeJavaScript(script))
  const settled = execution.finally(() => { busy.delete(contents) })
  try {
    return await Promise.race([
      settled,
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('capture_timeout')), timeoutMs) })
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}
