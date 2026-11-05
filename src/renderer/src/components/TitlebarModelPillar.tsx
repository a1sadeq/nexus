import { type FC, type KeyboardEvent, useRef } from 'react'
import type { ModelDef } from '../lib/models'
import { modelColor } from '../lib/modelVisuals'
import { BrandIcon } from './BrandIcons'
import './TitlebarModelPillar.css'

export interface TitlebarModelPillarProps {
  models: ModelDef[]
  activeModelKey: string
  onSelectModel: (key: string) => void
}

export const TitlebarModelPillar: FC<TitlebarModelPillarProps> = ({
  models,
  activeModelKey,
  onSelectModel
}) => {
  const buttonRefs = useRef<Map<string, HTMLButtonElement>>(new Map())

  // WAI-ARIA Roving Tabindex & Arrow Key Handler
  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const keys = models.map((m) => m.key)
    const currentIndex = keys.indexOf(activeModelKey)
    if (currentIndex === -1) return

    let nextIndex = currentIndex

    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault()
      nextIndex = (currentIndex + 1) % keys.length
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault()
      nextIndex = (currentIndex - 1 + keys.length) % keys.length
    } else if (e.key === 'Home') {
      e.preventDefault()
      nextIndex = 0
    } else if (e.key === 'End') {
      e.preventDefault()
      nextIndex = keys.length - 1
    }

    if (nextIndex !== currentIndex) {
      const nextKey = keys[nextIndex]
      onSelectModel(nextKey)
      buttonRefs.current.get(nextKey)?.focus()
    }
  }

  return (
    <div
      className="titlebar-model-pillar no-drag"
      role="radiogroup"
      aria-label="Active AI Provider Selector"
      onKeyDown={handleKeyDown}
    >
      {models.map((m) => {
        const isActive = m.key === activeModelKey
        const color = m.color || modelColor(m.key)
        return (
          <button
            key={m.key}
            ref={(el) => {
              if (el) buttonRefs.current.set(m.key, el)
              else buttonRefs.current.delete(m.key)
            }}
            type="button"
            role="radio"
            aria-checked={isActive}
            tabIndex={isActive ? 0 : -1}
            title={`${m.label} — Switch to provider`}
            className={`titlebar-model-pill no-drag ${isActive ? 'active' : ''}`}
            style={{ '--provider-color': color } as React.CSSProperties}
            onClick={() => onSelectModel(m.key)}
          >
            {m.icon ? (
              <span className="titlebar-model-icon" dangerouslySetInnerHTML={{ __html: m.icon }} />
            ) : (
              <BrandIcon id={m.key} size={14} className="titlebar-model-icon" />
            )}
            <span className="titlebar-model-label">{m.label}</span>
          </button>
        )
      })}
    </div>
  )
}

export default TitlebarModelPillar
