import { useEffect, useMemo, useState, type CSSProperties, type ReactElement } from 'react'

import {
  containerColorOf,
  containerNameOf,
  shortcutLabelForIndex,
  type ContainerInfo
} from '../lib/containers'
import { IconPlus, IconTrash, IconX } from './BrandIcons'
import './ContainerManager.css'

interface Props {
  containers: ContainerInfo[]
  tabCounts: Record<string, number>
  activeContainerId: string
  /** Account labels, so a row says "work@gmail.com" rather than a partition-friendly id. */
  accounts: Array<{ id: string; label: string }>
  onAdd: () => void
  onEdit: (containerId: string) => void
  onDelete: (containerId: string) => Promise<{ error?: string } | void> | void
  onClose: () => void
}

/**
 * The containers section: every container in one list, with add, edit and delete.
 *
 * Deleting is the only destructive one, so it asks first — inline, on the row, rather than a browser
 * confirm() that steals focus from the panel and can end up painted behind the native view.
 */
export default function ContainerManager({
  containers,
  tabCounts,
  activeContainerId,
  accounts,
  onAdd,
  onEdit,
  onDelete,
  onClose
}: Props): ReactElement {
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      if (confirmingId) {
        // Escape cancels the confirmation before it closes the panel: asking twice is worse than
        // closing the wrong thing.
        event.preventDefault()
        event.stopPropagation()
        setConfirmingId(null)
        return
      }
      event.preventDefault()
      onClose()
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [onClose, confirmingId])

  const accountLabel = (accountId: string): string =>
    accounts.find((a) => a.id === accountId)?.label ??
    (accountId === 'default' ? 'Default account' : accountId)

  const totalTabs = useMemo(
    () => containers.reduce((sum, c) => sum + (tabCounts[c.id] ?? 0), 0),
    [containers, tabCounts]
  )

  const remove = async (containerId: string): Promise<void> => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const result = await onDelete(containerId)
      if (result && typeof result === 'object' && 'error' in result && result.error) {
        setError(result.error)
        return
      }
      setConfirmingId(null)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div
        className="container-manager-scrim"
        onMouseDown={(_event) => {
          // Dismiss, and do not let the same press turn into a click on whatever was behind the panel:
          // dismissing the switcher should never also switch tabs.
          _event.preventDefault()
          _event.stopPropagation()
          onClose()
        }}
        aria-hidden
      />

      <div className="container-manager" role="dialog" aria-label="Containers">
        <div className="container-manager-head">
          <div className="container-manager-heading">
            <span className="container-manager-title">Containers</span>
            <span className="container-manager-sub">
              {containers.length} profile{containers.length === 1 ? '' : 's'} · {totalTabs} tab
              {totalTabs === 1 ? '' : 's'} · one Google account each
            </span>
          </div>
          <div className="container-manager-head-actions">
            <button type="button" className="container-manager-add" onClick={onAdd}>
              <IconPlus size={14} />
              <span>New container</span>
            </button>
            <button
              type="button"
              className="container-manager-close"
              onClick={onClose}
              title="Close (Esc)"
              aria-label="Close containers"
            >
              <IconX size={16} />
            </button>
          </div>
        </div>

        {error && <div className="container-manager-error">{error}</div>}

        <div className="container-manager-list">
          <div className="container-manager-cols" aria-hidden>
            <span />
            <span>Name</span>
            <span>Account</span>
            <span>Tabs</span>
            <span>Shortcut</span>
            <span />
          </div>

          {containers.map((container, index) => {
            const color = containerColorOf(container)
            const isActive = container.id === activeContainerId
            const isDefault = container.id === 'default'
            const count = tabCounts[container.id] ?? 0
            const confirming = confirmingId === container.id
            return (
              <div
                key={container.id}
                className={`container-manager-row${isActive ? ' is-active' : ''}${
                  confirming ? ' is-confirming' : ''
                }`}
                style={color ? ({ '--row-color': color } as CSSProperties) : undefined}
              >
                <span
                  className="container-manager-swatch"
                  style={
                    color
                      ? { background: color, boxShadow: `0 0 10px ${color}88` }
                      : { background: 'var(--text2)' }
                  }
                  title={color ?? 'no colour yet'}
                />

                <span className="container-manager-name">
                  {containerNameOf(container)}
                  {isActive && <span className="container-manager-current">current</span>}
                </span>

                <span className="container-manager-account">{accountLabel(container.accountId)}</span>

                <span className="container-manager-count">
                  {count === 0 ? '—' : count}
                </span>

                <span className="container-manager-key">{shortcutLabelForIndex(index + 1)}</span>

                <span className="container-manager-actions">
                  {confirming ? (
                    <>
                      <span className="container-manager-ask">
                        Delete{count > 0 ? ` and move ${count} tab${count === 1 ? '' : 's'} to Default` : ''}?
                      </span>
                      <button
                        type="button"
                        className="container-manager-confirm danger"
                        onClick={() => void remove(container.id)}
                        disabled={busy}
                      >
                        {busy ? 'Deleting…' : 'Delete'}
                      </button>
                      <button
                        type="button"
                        className="container-manager-confirm"
                        onClick={() => setConfirmingId(null)}
                        disabled={busy}
                      >
                        Keep
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="container-manager-edit"
                        onClick={() => onEdit(container.id)}
                        title={`Edit ${containerNameOf(container)}`}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="container-manager-delete"
                        onClick={() => {
                          setError(null)
                          setConfirmingId(container.id)
                        }}
                        // The default container is where every older tab already lives; main refuses to
                        // delete it, so the button says why instead of failing after the click.
                        disabled={isDefault}
                        title={
                          isDefault
                            ? 'The default container cannot be deleted — rename it instead'
                            : `Delete ${containerNameOf(container)}`
                        }
                        aria-label={`Delete ${containerNameOf(container)}`}
                      >
                        <IconTrash size={13} />
                      </button>
                    </>
                  )}
                </span>
              </div>
            )
          })}
        </div>

        <div className="container-manager-foot">
          <span className="container-manager-foot-hint">
            Tabs in a deleted container move to Default and keep working — the tab's cookie store
            cannot be moved after it is created, so it is relabelled rather than relocated.
          </span>
        </div>
      </div>
    </>
  )
}
