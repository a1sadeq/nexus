import type { ModelKey } from '../lib/tabs'
import { BrandIcon } from './BrandIcons'
import './ModelPills.css'

export interface ModelDef {
  key: ModelKey
  label: string
  url: string
  icon?: string
  color?: string
}

interface Props {
  models: ModelDef[]
  activeModel: ModelKey
  onSelect: (model: ModelKey) => void
}

const BRAND_IDS: Record<string, boolean> = {
  gemini: true,
  chatgpt: true,
  deepseek: true,
  qwen: true,
  kimi: true
}

export default function ModelPills({ models, activeModel, onSelect }: Props) {
  return (
    <div className="model-pills-track">
      {models.map((m) => (
        <button
          key={m.key}
          type="button"
          className={`model-pill ${activeModel === m.key ? 'active' : ''}`}
          onClick={() => onSelect(m.key)}
        >
          {BRAND_IDS[m.key] ? (
            <BrandIcon id={m.key} size={14} className="model-pill-icon" />
          ) : m.icon ? (
            <span className="model-pill-icon" dangerouslySetInnerHTML={{ __html: m.icon }} />
          ) : null}
          <span className="model-pill-label">{m.label.toUpperCase()}</span>
        </button>
      ))}
    </div>
  )
}
