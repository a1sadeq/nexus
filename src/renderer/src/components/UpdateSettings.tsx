import { useEffect, useState } from 'react'
import type { UpdateStatus } from '../../../shared/updateStatus'

export function UpdateSettings() {
  const [status, setStatus] = useState<UpdateStatus | null>(null)
  useEffect(() => {
    const ipc = window.electron?.ipcRenderer
    if (!ipc) return
    let mounted = true
    const remove = ipc.on('nexus-update-status', (_event: unknown, value: unknown) => {
      if (mounted && value && typeof value === 'object') setStatus(value as UpdateStatus)
    })
    void ipc.invoke('nexus-update-status').then((value: unknown) => {
      if (mounted && value && typeof value === 'object') setStatus((previous) => previous ?? value as UpdateStatus)
    }).catch(() => {})
    return () => { mounted = false; if (typeof remove === 'function') remove() }
  }, [])
  return (
    <section className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-2" aria-label="Automatic updates">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold">Automatic updates</h3>
        <span className="text-xs opacity-70">{status ? `v${status.currentVersion}` : 'Loading…'}</span>
      </div>
      <p className="text-xs opacity-80" role="status">{status?.message ?? 'Loading update status.'}</p>
      {status?.phase === 'downloading' && typeof status.percent === 'number' && (
        <progress className="w-full" aria-label="Update download progress" max={100} value={status.percent} />
      )}
      <p className="text-xs opacity-70">Supported installations download updates and restart automatically. Unsaved input and active tasks may be interrupted.</p>
      <button type="button" className="rounded border border-white/15 px-3 py-1.5 text-xs disabled:opacity-40"
        disabled={!status || status.phase === 'unsupported' || status.phase === 'checking' || status.phase === 'downloading' || status.phase === 'installing'}
        onClick={() => { void window.electron?.ipcRenderer.invoke('nexus-update-check').catch(() => {}) }}
      >
        Check for updates
      </button>
    </section>
  )
}
