import React from 'react'

interface HudStatusHeaderProps {
  onTriggerBoot?: () => void
}

export const HudStatusHeader: React.FC<HudStatusHeaderProps> = ({ onTriggerBoot }) => {
  return (
    <div className="flex items-center p-1.5 bg-[#050f14]/80 border border-[#00e5ff]/30 rounded-[4px] hud-bracket text-xs font-mono select-none">
      {/* Mini Pulsing Arc Reactor */}
      <button
        type="button"
        onClick={() => {
          onTriggerBoot?.()
        }}
        title="Arc Reactor Core Diagnostics (Click to run J.A.R.V.I.S. calibration)"
        className="relative w-5 h-5 flex items-center justify-center cursor-pointer group"
      >
        <svg
          className="absolute inset-0 w-full h-full hud-arc-spin group-hover:stroke-white transition-colors"
          viewBox="0 0 24 24"
          fill="none"
        >
          <circle
            cx="12"
            cy="12"
            r="10"
            stroke="#00e5ff"
            strokeWidth="1.5"
            strokeDasharray="4 2"
          />
        </svg>
        <div className="w-2 h-2 rounded-full bg-[#00e5ff] shadow-[0_0_6px_#00e5ff] group-hover:scale-125 transition-transform" />
      </button>
    </div>
  )
}
