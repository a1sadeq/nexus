import React, { useEffect, useState, useRef } from 'react'

interface JarvisBootOverlayProps {
  onComplete: () => void
  isReady?: boolean
}

const MIN_BOOT_DURATION_MS = 5000

export const JarvisBootOverlay: React.FC<JarvisBootOverlayProps> = ({
  onComplete,
  isReady = true
}) => {
  const [stage, setStage] = useState(0)
  const [progress, setProgress] = useState(0)
  const [fading, setFading] = useState(false)
  const [minTimeElapsed, setMinTimeElapsed] = useState(false)
  const completedRef = useRef(false)

  const finish = () => {
    if (completedRef.current) return
    completedRef.current = true
    setFading(true)
    setTimeout(() => {
      onComplete()
    }, 400)
  }

  // Keyboard shortcut: Escape to skip immediately
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        finish()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  // Progress bar & Stage progression over 5000ms
  useEffect(() => {
    const startTime = performance.now()

    const interval = setInterval(() => {
      const elapsed = performance.now() - startTime
      const p = Math.min(100, Math.round((elapsed / MIN_BOOT_DURATION_MS) * 100))
      setProgress(p)

      if (elapsed < 1200) {
        setStage(0)
      } else if (elapsed < 2400) {
        setStage(1)
      } else if (elapsed < 3600) {
        setStage(2)
      } else if (elapsed < 4800) {
        setStage(3)
      } else {
        setStage(4)
      }

      if (elapsed >= MIN_BOOT_DURATION_MS) {
        setMinTimeElapsed(true)
        clearInterval(interval)
      }
    }, 50)

    return () => clearInterval(interval)
  }, [])

  // Once minimum 5 seconds elapsed AND system isReady, dismiss
  useEffect(() => {
    if (minTimeElapsed && isReady) {
      const timer = setTimeout(() => {
        finish()
      }, 300)
      return () => clearTimeout(timer)
    }
    return undefined
  }, [minTimeElapsed, isReady])

  return (
    <div
      onClick={finish}
      className={`fixed inset-0 z-[99999] flex flex-col items-center justify-center bg-[#050f14] transition-opacity duration-400 select-none cursor-pointer ${
        fading ? 'opacity-0 pointer-events-none' : 'opacity-100'
      }`}
      style={{
        backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='34' height='60' viewBox='0 0 34 60'%3E%3Cpath d='M17 0 L34 10 L34 30 L17 40 L0 30 L0 10 Z M17 60 L34 50 L34 30 M0 50 L17 60' fill='none' stroke='rgba(0, 229, 255, 0.08)' stroke-width='1'/%3E%3C/svg%3E")`,
        backgroundSize: '34px 60px'
      }}
      title="Click or press ESC to skip"
    >
      {/* Holographic Scanline Overlay */}
      <div className="hud-scanline-overlay pointer-events-none" />

      {/* Hexagonal Frame & Corner Accents */}
      <div className="relative flex flex-col items-center max-w-lg w-full px-6">
        {/* Central Arc Reactor Graphic */}
        <div className="relative w-48 h-48 flex items-center justify-center mb-8">
          {/* Outer Tech Ring - Clockwise */}
          <svg
            className="absolute inset-0 w-full h-full hud-arc-spin"
            viewBox="0 0 100 100"
            fill="none"
          >
            <circle
              cx="50"
              cy="50"
              r="46"
              stroke="#00e5ff"
              strokeWidth="1.5"
              strokeDasharray="14 8 4 8"
              opacity="0.85"
            />
            <circle
              cx="50"
              cy="50"
              r="40"
              stroke="#0d47a1"
              strokeWidth="1"
              strokeDasharray="6 4"
              opacity="0.6"
            />
          </svg>

          {/* Middle Counter-Rotating Ring */}
          <svg
            className="absolute inset-2 w-44 h-44 hud-arc-spin-reverse"
            viewBox="0 0 100 100"
            fill="none"
          >
            <circle
              cx="50"
              cy="50"
              r="44"
              stroke="#00bfff"
              strokeWidth="1"
              strokeDasharray="24 16"
              opacity="0.9"
            />
            <circle
              cx="50"
              cy="50"
              r="36"
              stroke="#00e5ff"
              strokeWidth="0.75"
              strokeDasharray="2 6"
              opacity="0.7"
            />
          </svg>

          {/* Radar Scanner Sweep */}
          <div className="absolute inset-4 rounded-full border border-[#00e5ff]/20 overflow-hidden">
            <div className="w-full h-full bg-gradient-to-tr from-transparent via-[#00e5ff]/10 to-transparent animate-spin duration-1000" />
          </div>

          {/* Center Pulsing Arc Core */}
          <div className="relative w-16 h-16 rounded-full bg-[#07101e] border-2 border-[#00e5ff] flex items-center justify-center hud-arc-pulse shadow-[0_0_28px_rgba(0,229,255,0.85)]">
            <div className="w-8 h-8 rounded-full bg-[#00e5ff] opacity-80 blur-[2px]" />
            <div className="absolute w-4 h-4 rounded-full bg-white shadow-[0_0_12px_#ffffff]" />
          </div>
        </div>

        {/* J.A.R.V.I.S. Telemetry Feed */}
        <div className="font-mono text-center tracking-[0.22em] uppercase text-xs w-full">
          <div className="text-[#00e5ff] font-bold text-sm mb-2 drop-shadow-[0_0_10px_rgba(0,229,255,0.9)] flex items-center justify-center gap-2">
            <span className="w-2 h-2 rounded-full bg-[#00e5ff] animate-ping" />
            STARK INDUSTRIES // MARK-HUD OS
          </div>

          {/* Diagnostic Message Stages */}
          <div className="h-10 flex flex-col justify-center items-center">
            <div className="text-[#4dd0e1] text-xs font-semibold tracking-wider transition-all duration-300">
              {stage === 0 && '>> INITIALIZING ARC REACTOR CORE & PROTOCOLS...'}
              {stage === 1 && '>> CALIBRATING HUD OPTICS & DISPLAY MATRICES...'}
              {stage === 2 && '>> ENGAGING SECURE AI PROVIDER NEURAL BRIDGES...'}
              {stage === 3 && '>> RUNTIME TELEMETRY & CACHE SYNCHRONIZATION...'}
              {stage >= 4 && (
                isReady
                  ? '>> MARK-HUD SYSTEM CALIBRATED // ALL SYSTEMS NOMINAL'
                  : '>> SYNCHRONIZING WITH ACTIVE NEURAL WORKSPACE...'
              )}
            </div>
          </div>

          {/* Holographic Progress Gauge */}
          <div className="w-full mt-4 mb-2 bg-[#00e5ff]/10 border border-[#00e5ff]/40 p-0.5 rounded-[2px] shadow-[0_0_10px_rgba(0,229,255,0.2)]">
            <div
              className="h-1.5 bg-gradient-to-r from-[#00b0ff] via-[#00e5ff] to-[#76ff03] transition-all duration-75 ease-out shadow-[0_0_8px_#00e5ff]"
              style={{ width: `${progress}%` }}
            />
          </div>

          <div className="flex justify-between items-center text-[10px] text-[#4dd0e1]/70 font-mono tracking-widest px-1">
            <span>SYS.DIAG // {progress}%</span>
            <span>{isReady ? 'READY' : 'LOADING...'}</span>
          </div>

          <div className="text-[#ffb700] text-[10px] mt-6 tracking-widest animate-pulse opacity-80 hover:opacity-100 transition-opacity">
            [ PRESS ESC OR CLICK ANYWHERE TO BYPASS ]
          </div>
        </div>
      </div>
    </div>
  )
}
