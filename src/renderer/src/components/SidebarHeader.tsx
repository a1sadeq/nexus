import type { ModelKey } from '../lib/tabs'
import ModelPills, { ModelDef } from './ModelPills'
import { IconPlus, IconSearch } from './BrandIcons'
import './SidebarHeader.css'

interface Props {
  models: ModelDef[]
  activeModel: ModelKey
  onSelect: (model: ModelKey) => void
  onNewChat: () => void
  onOpenHistory: () => void
}

export default function SidebarHeader({
  models,
  activeModel,
  onSelect,
  onNewChat,
  onOpenHistory
}: Props) {
  return (
    <div className="sidebar-header-row">
      {/* Empty spacer to balance the flex layout */}
      <div className="sidebar-header-spacer"></div>

      {/* Centered pills */}
      <div className="sidebar-header-center">
        <ModelPills models={models} activeModel={activeModel} onSelect={onSelect} />
      </div>

      {/* Right aligned actions */}
      <div className="sidebar-header-actions">
        <button type="button" className="header-action-btn" onClick={onNewChat} title="New chat">
          <IconPlus size={16} />
        </button>
        <button
          type="button"
          className="header-action-btn"
          onClick={onOpenHistory}
          title="Chat history (fzf search)"
        >
          <IconSearch size={14} />
        </button>
      </div>
    </div>
  )
}
