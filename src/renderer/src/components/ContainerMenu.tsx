import { useEffect, useRef, type CSSProperties, type ReactElement } from 'react'

import {
  containerColorOf,
  containerNameOf,
  shortcutLabelForIndex,
  type ContainerInfo
} from '../lib/containers'
import { IconPlus, IconX } from './BrandIcons'
import './ContainerMenu.css'

interface Props {
  containers: ContainerInfo[]
  tabCounts: Record<string, number>
  activeContainerId: string
  /** Account labels, so a row says "2016" rather than a partition-friendly id. */
  accounts: Array<{ id: string; label: string }>
  onOpenContainer: (containerId: string) => void
  onEditContainer: (containerId: string) => void
  onNewContainer: () => void
  /** Opens the containers section, where they can also be deleted. */
  onManageContainers: () => void
  onClose: () => void
}

/**
 * The container / profile switcher, at the size it is actually read at: centred in the window,
 * one large row per container, each row painted in that container's own colour so the thing you
 * pick is the thing you will see in the aura and on the tools-row button.
 *
 * Keys, all inside the panel: 1…9 open that container (the same digits `Ctrl+Alt+N` uses), Escape
 * or `Ctrl+.` close it.
 */
export default function ContainerMenu({
  containers,
  tabCounts,
  activeContainerId,
  accounts,
  onOpenContainer,
  onEditContainer,
  onNewContainer,
  onManageContainers,
  onClose
}: Props): ReactElement {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }
      // Digits are a genuine second way in: the panel is an overlay, so the main process is not
      // routing Ctrl+Alt+N while it is up.
      if (event.ctrlKey || event.metaKey || event.altKey) return
      const target = event.target as HTMLElement | null
      const tag = target?.tagName?.toLowerCase()
      if (tag === 'input' || tag === 'textarea' || target?.isContentEditable) return
      const digit = /^[1-9]$/.test(event.key)
        ? Number(event.key)
        : /^(Digit|Numpad)([1-9])$/.test(event.code || '')
          ? Number((event.code || '').slice(-1))
          : null
      if (digit === null) return
      const container = containers[digit - 1]
      if (!container) return
      event.preventDefault()
      onOpenContainer(container.id)
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [onClose, onOpenContainer, containers])

  const accountLabel = (accountId: string): string =>
    accounts.find((a) => a.id === accountId)?.label ??
    (accountId === 'default' ? 'Default account' : accountId)

  return (
    <>
      {/* Dimmed, blurred backdrop. The native AI view is hidden while this is open, so without a
          scrim the panel would float over a hole. */}
      <div
        className="container-menu-scrim"
        onMouseDown={(_event) => {
          // Dismiss, and do not let the same press turn into a click on whatever was behind the panel:
          // dismissing the switcher should never also switch tabs.
          _event.preventDefault()
          _event.stopPropagation()
          onClose()
        }}
        aria-hidden
      />

      <div ref={ref} className="container-menu" role="dialog" aria-label="Containers and profiles">
        <div className="container-menu-head">
          <div className="container-menu-heading">
            <span className="container-menu-title">Containers</span>
            <span className="container-menu-sub">
              {containers.length} profile{containers.length === 1 ? '' : 's'} · one Google account
              each
            </span>
          </div>
          <div className="container-menu-head-actions">
            <span className="container-menu-hint">Ctrl+.</span>
            <button
              type="button"
              className="container-menu-close"
              onClick={onClose}
              title="Close (Esc)"
              aria-label="Close containers"
            >
              <IconX size={15} />
            </button>
          </div>
        </div>

        <div className={`container-menu-list${containers.length >= 4 ? ' rooms-two' : ''}`}>
          {containers.map((container, index) => {
            const color = containerColorOf(container)
            const count = tabCounts[container.id] ?? 0
            const tabs = count === 0 ? 'empty' : `${count} tab${count === 1 ? '' : 's'}`
            const isActive = container.id === activeContainerId
            return (
              <div
                key={container.id}
                className={`container-row${isActive ? ' is-active' : ''}`}
                style={
                  color
                    ? ({
                        '--row-color': color,
                        borderColor: isActive
                          ? `color-mix(in srgb, ${color} 55%, transparent)`
                          : undefined
                      } as CSSProperties)
                    : undefined
                }
              >
                <button
                  type="button"
                  className="container-row-main"
                  onClick={() => onOpenContainer(container.id)}
                  title={`Open a tab in ${containerNameOf(container)} — ${shortcutLabelForIndex(index + 1)}`}
                >
                  <span
                    className="container-row-dot"
                    style={
                      color
                        ? { background: color, boxShadow: `0 0 0 3px ${color}22, 0 0 14px ${color}99` }
                        : { background: 'var(--text2)' }
                    }
                  />
                  <span className="container-row-text">
                    <span className="container-row-name">
                      {containerNameOf(container)}
                      {isActive && <span className="container-row-current">current</span>}
                    </span>
                    <span className="container-row-meta">
                      {accountLabel(container.accountId)} · {tabs}
                    </span>
                  </span>
                  <span className="container-row-key">{shortcutLabelForIndex(index + 1)}</span>
                </button>
                <button
                  type="button"
                  className="container-row-edit"
                  onClick={() => onEditContainer(container.id)}
                  title="Name, colour and account"
                  aria-label={`Edit ${containerNameOf(container)}`}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="1" />
                    <circle cx="19" cy="12" r="1" />
                    <circle cx="5" cy="12" r="1" />
                  </svg>
                </button>
              </div>
            )
          })}
        </div>

        <div className="container-menu-foot">
          <button type="button" className="container-menu-new" onClick={onNewContainer}>
            <IconPlus size={14} />
            <span>New container</span>
          </button>
          <button type="button" className="container-menu-manage" onClick={onManageContainers}>
            Manage…
          </button>
          <span className="container-menu-foot-hint">
            Press a number to switch · Ctrl+Alt+N from outside · Esc to close
          </span>
        </div>
      </div>
    </>
  )
}
