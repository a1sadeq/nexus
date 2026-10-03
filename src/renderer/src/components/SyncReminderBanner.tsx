import { useState, useEffect } from 'react'

export const HAS_SYNCED_SESSIONS_KEY = 'nexus.has_synced_sessions'
export const SYNC_BANNER_DISMISSED_KEY = 'nexus.sync_banner_dismissed'

interface SyncReminderBannerProps {
  onSyncComplete?: (count: number) => void
  onOpenSettings?: (section?: 'general' | 'models' | 'themes' | 'webview' | 'shortcuts') => void
}

export default function SyncReminderBanner({ onSyncComplete, onOpenSettings }: SyncReminderBannerProps) {
  const [visible, setVisible] = useState(() => {
    try {
      const hasSynced =
        localStorage.getItem(HAS_SYNCED_SESSIONS_KEY) === 'true' ||
        localStorage.getItem('vicinae.has_synced_sessions') === 'true'
      const dismissed =
        sessionStorage.getItem(SYNC_BANNER_DISMISSED_KEY) === 'true' ||
        sessionStorage.getItem('vicinae.sync_banner_dismissed') === 'true'
      return !hasSynced && !dismissed
    } catch {
      return false
    }
  })
  const [isSyncing, setIsSyncing] = useState(false)
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

  // Listen for storage events in case settings synced sessions in another tab/action
  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (e.key === HAS_SYNCED_SESSIONS_KEY && e.newValue === 'true') {
        setVisible(false)
      }
    }
    window.addEventListener('storage', handleStorage)
    return () => window.removeEventListener('storage', handleStorage)
  }, [])

  if (!visible) return null

  const handleDismiss = () => {
    try {
      sessionStorage.setItem(SYNC_BANNER_DISMISSED_KEY, 'true')
    } catch {
      // ignore
    }
    setVisible(false)
  }

  const handleSync = async () => {
    setIsSyncing(true)
    setFeedback(null)
    try {
      // @ts-ignore
      const res = (await window.electron?.sessions?.syncAll?.()) || (await window.electron?.googleSignIn?.syncAll?.())
      if (res && res.success) {
        const count = res.count ?? 0
        setFeedback({
          type: 'success',
          message: `Synced ${count} session cookies!`
        })
        try {
          localStorage.setItem(HAS_SYNCED_SESSIONS_KEY, 'true')
        } catch {
          // ignore
        }
        if (onSyncComplete) onSyncComplete(count)
        setTimeout(() => {
          setVisible(false)
        }, 2200)
      } else {
        setFeedback({
          type: 'error',
          message: res?.message || 'No session cookies found in browsers.'
        })
      }
    } catch (err) {
      setFeedback({
        type: 'error',
        message: `Sync failed: ${err instanceof Error ? err.message : String(err)}`
      })
    } finally {
      setIsSyncing(false)
    }
  }

  return (
    <div
      className="fixed top-2 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-3.5 py-2 rounded-xl border shadow-xl backdrop-blur-md transition-all duration-300 text-xs animate-in fade-in slide-in-from-top-3"
      style={{
        background: 'rgba(26, 27, 38, 0.85)',
        borderColor: 'rgba(255, 255, 255, 0.12)',
        color: '#e2e8f0',
        boxShadow: '0 8px 32px 0 rgba(0, 0, 0, 0.37)'
      }}
    >
      <div className="flex items-center gap-2">
        <span className="p-1 rounded-md bg-amber-500/20 text-amber-300 flex items-center justify-center shrink-0">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 2l-2 2m-1-1l-3 3m-1-1l-2 2m-1-1l-3 3m-1-1l-2 2" />
            <circle cx="7.5" cy="16.5" r="4.5" />
            <path d="m10.5 13.5 9-9" />
          </svg>
        </span>
        <span className="font-medium opacity-90">
          {feedback ? feedback.message : 'Sync browser sessions to enable seamless AI logins across providers'}
        </span>
      </div>

      <div className="flex items-center gap-1.5 ml-1">
        {!feedback && (
          <button
            onClick={handleSync}
            disabled={isSyncing}
            className="px-2.5 py-1 rounded-lg font-semibold text-[11px] flex items-center gap-1.5 transition-all hover:opacity-90 disabled:opacity-50 shadow-sm"
            style={{ background: 'var(--accent, #6366f1)', color: '#fff' }}
          >
            {isSyncing ? (
              <>
                <svg className="animate-spin h-3 w-3 text-white" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                </svg>
                Syncing…
              </>
            ) : (
              <>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
                </svg>
                Sync All Sessions
              </>
            )}
          </button>
        )}

        {feedback?.type === 'error' && (
          <button
            onClick={() => {
              setVisible(false)
              if (onOpenSettings) onOpenSettings('general')
            }}
            className="px-2.5 py-1 rounded-lg font-semibold text-[11px] flex items-center gap-1.5 transition-all hover:opacity-90 shadow-sm"
            style={{ background: 'var(--accent, #6366f1)', color: '#fff' }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
            Open Settings
          </button>
        )}

        <button
          onClick={handleDismiss}
          className="p-1 rounded-md opacity-60 hover:opacity-100 hover:bg-white/10 transition-all text-slate-300"
          title="Dismiss for this session"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
    </div>
  )
}
