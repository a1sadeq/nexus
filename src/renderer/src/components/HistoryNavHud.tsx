import { useEffect, useState } from 'react'

export interface HistoryNavEvent {
  action: 'back' | 'forward' | 'boundary'
  message: string
}

export default function HistoryNavHud() {
  const [hud, setHud] = useState<HistoryNavEvent | null>(null)

  useEffect(() => {
    // @ts-ignore
    const onHud = (_event: unknown, data: HistoryNavEvent) => {
      setHud(data)
    }

    // @ts-ignore
    window.electron?.ipcRenderer?.on?.('history-nav-hud', onHud)

    return () => {
      // @ts-ignore
      window.electron?.ipcRenderer?.removeListener?.('history-nav-hud', onHud)
    }
  }, [])

  useEffect(() => {
    if (!hud) return
    const timer = setTimeout(() => {
      setHud(null)
    }, 1000)
    return () => clearTimeout(timer)
  }, [hud])

  if (!hud) return null

  const isBack = hud.action === 'back'
  const isForward = hud.action === 'forward'

  return (
    <div
      className={`fixed top-1/2 -translate-y-1/2 z-50 pointer-events-none flex items-center gap-2 px-3.5 py-2 rounded-2xl border shadow-2xl backdrop-blur-md transition-all duration-200 text-xs font-semibold animate-in fade-in zoom-in-95 ${
        isBack ? 'left-6' : isForward ? 'right-6' : 'left-1/2 -translate-x-1/2'
      }`}
      style={{
        background: 'rgba(15, 23, 42, 0.88)',
        borderColor: 'rgba(255, 255, 255, 0.15)',
        color: '#f8fafc',
        boxShadow: '0 10px 30px rgba(0, 0, 0, 0.5)'
      }}
    >
      {isBack && (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="15 18 9 12 15 6" />
        </svg>
      )}
      <span>{hud.message}</span>
      {isForward && (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="9 18 15 12 9 6" />
        </svg>
      )}
    </div>
  )
}
