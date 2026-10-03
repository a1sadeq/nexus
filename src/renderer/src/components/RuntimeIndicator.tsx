

export default function RuntimeIndicator() {
  const isElectron = Boolean((window as any).electron)

  const handleToggle = () => {
    if (isElectron) {
      // @ts-ignore
      window.electron.ipcRenderer.invoke('switch_to_tauri')
    } else {
      // @ts-ignore
      window.__TAURI__.invoke('switch_to_electron')
    }
  }

  return (
    <button
      onClick={handleToggle}
      className={`px-3 py-1 rounded-full text-xs font-bold tracking-widest border transition-all hover:scale-105 shadow-sm ml-2 ${
        isElectron
          ? 'bg-blue-500/10 text-blue-400 border-blue-500/30 hover:bg-blue-500/20 hover:border-blue-500/50'
          : 'bg-orange-500/10 text-orange-400 border-orange-500/30 hover:bg-orange-500/20 hover:border-orange-500/50'
      }`}
      title={`Currently running in ${isElectron ? 'Nexus (Electron)' : 'Nexus Lite (Tauri)'}. Click to switch.`}
    >
      {isElectron ? (
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-cpu"><rect width="16" height="16" x="4" y="4" rx="2"/><rect width="6" height="6" x="9" y="9" rx="1"/><path d="M15 2v2"/><path d="M15 20v2"/><path d="M2 15h2"/><path d="M2 9h2"/><path d="M20 15h2"/><path d="M20 9h2"/><path d="M9 2v2"/><path d="M9 20v2"/></svg>
      ) : (
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-zap"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
      )}
    </button>
  )
}
