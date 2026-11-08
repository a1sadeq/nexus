import React from 'react'
import type { TabAiStatus } from '../lib/tabStatus'

interface Props {
  status?: TabAiStatus
  modelColor?: string
  className?: string
}

export const AiStatusBadge: React.FC<Props> = ({
  status = 'idle',
  className = ''
}) => {
  // 1. Idle: Blue color
  if (status === 'idle') {
    return (
      <span
        role="status"
        aria-label="AI is idle and ready"
        className={`relative flex h-2 w-2 shrink-0 transition-all duration-300 ${className}`}
        title="Ready"
      >
        <span className="relative inline-flex rounded-full h-2 w-2 bg-sky-400 shadow-[0_0_6px_rgba(56,189,248,0.75)] opacity-85" />
      </span>
    )
  }

  // 2. Thinking / Generating: Purple color
  if (status === 'working') {
    return (
      <span
        role="status"
        aria-label="AI is thinking and generating response"
        className={`relative flex h-2.5 w-2.5 shrink-0 transition-opacity duration-300 ${className}`}
        title="Thinking / Generating…"
      >
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-purple-400 opacity-75 duration-1000" />
        <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-purple-500 shadow-[0_0_10px_rgba(168,85,247,0.9)] border border-purple-300/40" />
      </span>
    )
  }

  // 3. Waiting User's Input: Red (Iron Man red with gold/ruby glow)
  if (status === 'waiting-input') {
    return (
      <span
        role="status"
        aria-label="AI completed task, waiting for your input or response"
        className={`relative flex h-3 w-3 shrink-0 transition-opacity duration-300 ${className}`}
        title="AI finished — waiting for your input / choice"
      >
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-80 duration-1000" />
        <span className="relative inline-flex rounded-full h-3 w-3 bg-red-600 shadow-[0_0_12px_rgba(220,38,38,1),0_0_4px_rgba(251,191,36,0.8)] border border-amber-400/80" />
      </span>
    )
  }

  // 4. Done: Green color
  if (status === 'done') {
    return (
      <span
        role="status"
        aria-label="AI finished task"
        className={`relative flex h-2.5 w-2.5 shrink-0 transition-all duration-300 ${className}`}
        title="Finished"
      >
        <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.9)] border border-emerald-400/40" />
      </span>
    )
  }

  return null
}
