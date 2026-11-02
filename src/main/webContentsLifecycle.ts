// Public Electron API only. Never infer successful teardown from a removed map entry.
export interface ClosableContents {
  close(options?: { waitForBeforeUnload?: boolean }): void
  isDestroyed(): boolean
  once(event: 'destroyed', listener: () => void): unknown
  removeListener(event: 'destroyed', listener: () => void): unknown
}

export function closeWebContents(contents: ClosableContents, timeoutMs = 3000): Promise<void> {
  if (contents.isDestroyed()) return Promise.resolve()
  return new Promise<void>((resolve, reject) => {
    let settled = false
    const finish = (error?: Error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      contents.removeListener('destroyed', onDestroyed)
      if (error) reject(error)
      else resolve()
    }
    const onDestroyed = () => finish()
    const timer = setTimeout(() => {
      if (contents.isDestroyed()) finish()
      else finish(new Error('WebContents close timed out; resource remains tracked'))
    }, timeoutMs)
    contents.once('destroyed', onDestroyed)
    try {
      // Discard was already authorized by the existing policy. Do not permit an
      // unload handler to hang cleanup; draft/generation protection is separate.
      contents.close({ waitForBeforeUnload: false })
      if (contents.isDestroyed()) finish()
    } catch (error) {
      finish(error instanceof Error ? error : new Error(String(error)))
    }
  })
}
