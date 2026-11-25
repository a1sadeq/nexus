import { useEffect, useMemo, useState, type CSSProperties, type ReactElement } from 'react'

import {
  canMoveContainerInList,
  containerColorOf,
  containerNameOf,
  shortcutLabelForIndex,
  type ContainerInfo
} from '../lib/containers'
import { IconChevronLeft, IconPlus, IconRotate, IconTrash, IconX } from './BrandIcons'
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
  /** Moves a row one place; the list order is what `Ctrl+Alt+N` and the switcher follow. */
  onReorder: (containerId: string, delta: number) => void
  /** Clears that profile's session and starts the Google sign-in from the beginning. */
  onReconnect: (containerId: string) => Promise<{ ok: boolean; error?: string } | void> | void
  onClose: () => void
}

/**
 * The containers section: every profile in one list, with add, edit, delete, reorder and reconnect.
 *
 * Deleting and reconnecting are the two that cost something, so each asks first — inline, on the row,
 * rather than a browser confirm() that steals focus from the panel and can end up painted behind the
 * native view. Escape cancels an open question before it closes the panel: asking twice is worse than
 * closing the wrong thing.
 */
export default function ContainerManager({
  containers,
  tabCounts,
  activeContainerId,
  accounts,
  onAdd,
  onEdit,
  onDelete,
  onReorder,
  onReconnect,
  onClose
}: Props): ReactElement {
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const [reconnectingId, setReconnectingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      if (confirmingId || reconnectingId) {
        event.preventDefault()
        event.stopPropagation()
        setConfirmingId(null)
        setReconnectingId(null)
        return
      }
      event.preventDefault()
      onClose()
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [onClose, confirmingId, reconnectingId])

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

  const reconnect = async (containerId: string): Promise<void> => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const result = await onReconnect(containerId)
      if (result && typeof result === 'object' && 'ok' in result && !result.ok) {
        setError(result.error ?? 'Could not start the sign-in again.')
        return
      }
      setReconnectingId(null)
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
            const reconnecting = reconnectingId === container.id
            const canUp = canMoveContainerInList(containers, container.id, -1)
            const canDown = canMoveContainerInList(containers, container.id, 1)
            const name = containerNameOf(container)
            return (
              <div
                key={container.id}
                className={`container-manager-row${isActive ? ' is-active' : ''}${
                  confirming ? ' is-confirming' : ''
                }${reconnecting ? ' is-reconnecting' : ''}`}
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
                  {name}
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
                  ) : reconnecting ? (
                    <>
                      <span className="container-manager-ask">
                        {isDefault
                          ? `Sign Google out of all ${count} tab${count === 1 ? '' : 's'} and sign in again?`
                          : 'Sign this profile out of Google and sign in again?'}
                      </span>
                      <button
                        type="button"
                        className="container-manager-confirm danger"
                        onClick={() => void reconnect(container.id)}
                        disabled={busy}
                      >
                        {busy ? 'Clearing…' : 'Sign in again'}
                      </button>
                      <button
                        type="button"
                        className="container-manager-confirm"
                        onClick={() => setReconnectingId(null)}
                        disabled={busy}
                      >
                        Keep
                      </button>
                    </>
                  ) : (
                    <>
                      <span className="container-manager-move">
                        <button
                          type="button"
                          className="container-manager-move-button is-up"
                          onClick={() => onReorder(container.id, -1)}
                          disabled={!canUp}
                          title={canUp ? `Move ${name} up` : 'Already first'}
                          aria-label={`Move ${name} up`}
                        >
                          <IconChevronLeft size={13} />
                        </button>
                        <button
                          type="button"
                          className="container-manager-move-button is-down"
                          onClick={() => onReorder(container.id, 1)}
                          disabled={!canDown}
                          title={canDown ? `Move ${name} down` : 'Already last'}
                          aria-label={`Move ${name} down`}
                        >
                          <IconChevronLeft size={13} />
                        </button>
                      </span>
                      <button
                        type="button"
                        className="container-manager-reconnect"
                        onClick={() => {
                          setError(null)
                          setConfirmingId(null)
                          setReconnectingId(container.id)
                        }}
                        title={`Sign ${name} in again — clears this profile's Google session so another account can be chosen`}
                      >
                        <IconRotate size={12} />
                        <span>Sign in again</span>
                      </button>
                      <button
                        type="button"
                        className="container-manager-edit"
                        onClick={() => onEdit(container.id)}
                        title={`Edit ${name}`}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="container-manager-delete"
                        onClick={() => {
                          setError(null)
                          setReconnectingId(null)
                          setConfirmingId(container.id)
                        }}
                        // The default container is where every older tab already lives; main refuses to
                        // delete it, so the button says why instead of failing after the click.
                        disabled={isDefault}
                        title={
                          isDefault
                            ? 'The default container cannot be deleted — rename it instead'
                            : `Delete ${name}`
                        }
                        aria-label={`Delete ${name}`}
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
            Order sets the switcher and <b>Ctrl+Alt+1…9</b> — 0 always means the first row. Signing in
            again clears this profile&apos;s <b>Google</b> session only: Gemini, ChatGPT and Claude stay
            signed in. Pick a different account there and rename the profile from <b>Edit</b>. Tabs in a
            deleted container move to Default and keep working: a tab&apos;s cookie store cannot be moved
            after it is created, so it is relabelled rather than relocated.
          </span>
        </div>
      </div>
    </>
  )
}
