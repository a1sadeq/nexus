import { useEffect, useState } from 'react'
import type { UpdateStatus } from '../../../shared/updateStatus'

/** "14:05" — the settings panel is read at a glance, not parsed. */
function clockOf(value: number | undefined): string {
  if (!value || !Number.isFinite(value)) return ''
  try {
    return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  } catch {
    return ''
  }
}

function sizeOf(bytesPerSecond: number | undefined): string {
  if (!bytesPerSecond || !Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) return ''
  const mb = bytesPerSecond / (1024 * 1024)
  return mb >= 1 ? `${mb.toFixed(1)} MB/s` : `${Math.round(bytesPerSecond / 1024)} KB/s`
}

export function UpdateSettings() {
  const [status, setStatus] = useState<UpdateStatus | null>(null)
  const [busy, setBusy] = useState(false)
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

  const ask = (channel: string) => {
    const ipc = window.electron?.ipcRenderer
    if (!ipc) return
    setBusy(true)
    void ipc.invoke(channel).then((value: unknown) => {
      if (value && typeof value === 'object') setStatus(value as UpdateStatus)
    }).catch(() => {}).finally(() => setBusy(false))
  }

  const ready = status?.phase === 'ready'
  const working = status?.phase === 'checking' || status?.phase === 'downloading' || status?.phase === 'installing'
  const lastChecked = clockOf(status?.lastCheckedAt)
  const nextCheck = clockOf(status?.nextCheckAt)
  const speed = sizeOf(status?.bytesPerSecond)

  return (
    <section className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-2" aria-label="Automatic updates">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold">Automatic updates</h3>
        <span className="text-xs opacity-70">{status ? `v${status.currentVersion}` : 'Loading…'}</span>
      </div>

      <p className="text-xs opacity-80" role="status">{status?.message ?? 'Loading update status.'}</p>

      {status?.phase === 'downloading' && typeof status.percent === 'number' && (
        <div className="space-y-1">
          <progress className="w-full" aria-label="Update download progress" max={100} value={status.percent} />
          <p className="text-[11px] opacity-60">
            {Math.round(status.percent)}%{speed ? ` · ${speed}` : ''}
          </p>
        </div>
      )}

      {ready && (
        <div className="flex items-center gap-2 pt-1">
          <button
            type="button"
            className="rounded border border-white/25 bg-white/10 px-3 py-1.5 text-xs font-medium disabled:opacity-40"
            disabled={busy}
            onClick={() => ask('nexus-update-install')}
          >
            Restart &amp; install{status?.targetVersion ? ` ${status.targetVersion}` : ''}
          </button>
          <button
            type="button"
            className="rounded border border-white/15 px-3 py-1.5 text-xs disabled:opacity-40"
            disabled={busy}
            onClick={() => ask('nexus-update-defer')}
          >
            Later
          </button>
        </div>
      )}

      <p className="text-xs opacity-70">
        {ready
          ? 'It installs by itself in a few minutes, and on any quit — so choosing Later never costs you the update.'
          : 'Nexus checks every 15 minutes, and also when the window comes back or the machine wakes up. Updates download on their own and install without you downloading anything again.'}
      </p>

      <div className="flex items-center justify-between gap-3 pt-1">
        <button
          type="button"
          className="rounded border border-white/15 px-3 py-1.5 text-xs disabled:opacity-40"
          disabled={!status || busy || working || ready || status?.phase === 'unsupported'}
          onClick={() => ask('nexus-update-check')}
        >
          Check for updates
        </button>
        <span className="text-[11px] opacity-50" aria-label="Update schedule">
          {lastChecked ? `Checked ${lastChecked}` : 'Not checked yet'}
          {nextCheck && !working && !ready ? ` · next ${nextCheck}` : ''}
        </span>
      </div>
    </section>
  )
}
