import { useEffect, useState, type ReactElement } from 'react'

import {
  CONTAINER_COLOR_PRESETS,
  DEFAULT_CONTAINER_ID,
  containerColorOf,
  type ContainerInfo
} from '../lib/containers'
import { normaliseHexColor } from '../lib/tabColors'
import './ContainerModal.css'

export interface ContainerAccountOption {
  id: string
  label: string
}

interface Props {
  /** `null` creates a new container; an id edits that one. */
  editing: ContainerInfo | null
  accounts: ContainerAccountOption[]
  /** How many tabs would be affected by deleting (or by pointing at another account). */
  tabCount: number
  onSave: (input: {
    id?: string
    name: string
    color?: string | null
    accountId: string
  }) => Promise<{ error?: string } | void>
  onDelete: (containerId: string) => Promise<{ error?: string } | void>
  onClose: () => void
}

export default function ContainerModal({
  editing,
  accounts,
  tabCount,
  onSave,
  onDelete,
  onClose
}: Props): ReactElement {
  const [name, setName] = useState(editing?.name ?? '')
  const [color, setColor] = useState<string | undefined>(containerColorOf(editing))
  const [accountId, setAccountId] = useState(editing?.accountId ?? accounts[0]?.id ?? 'default')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
      }
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [onClose])

  const isEditing = Boolean(editing)
  const isDefault = editing?.id === DEFAULT_CONTAINER_ID

  const submit = async (): Promise<void> => {
    if (busy) return
    const trimmed = name.trim()
    if (!trimmed) {
      setError('Give the container a name first.')
      return
    }
    if (color && !normaliseHexColor(color)) {
      setError('Colours must be hex, like #f43f5e.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const result = await onSave({
        id: editing?.id,
        name: trimmed,
        color: color ? normaliseHexColor(color) : null,
        accountId
      })
      if (result && 'error' in result && result.error) {
        setError(result.error)
        return
      }
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the container.')
    } finally {
      setBusy(false)
    }
  }

  const remove = async (): Promise<void> => {
    if (!editing) return
    setBusy(true)
    setError(null)
    try {
      const result = await onDelete(editing.id)
      if (result && 'error' in result && result.error) {
        setError(result.error)
        return
      }
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete the container.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="container-modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="container-modal" role="dialog" aria-label={isEditing ? 'Edit container' : 'New container'}>
        <div className="container-modal-head">
          <h3>{isEditing ? 'Edit container' : 'New container'}</h3>
          <span className="container-modal-sub">
            Its own cookie store, so two accounts never mix.
          </span>
        </div>

        <label className="container-modal-field">
          <span>Name</span>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submit()
            }}
            placeholder="Work, Personal, Client X…"
            maxLength={40}
          />
        </label>

        <div className="container-modal-field">
          <span>Colour — the aura around its tabs</span>
          <div className="container-modal-swatches">
            {CONTAINER_COLOR_PRESETS.map((preset) => {
              const active = normaliseHexColor(color) === preset.hex
              return (
                <button
                  key={preset.hex}
                  type="button"
                  className={`container-swatch${active ? ' is-active' : ''}`}
                  style={{ background: preset.hex }}
                  title={preset.name}
                  aria-label={preset.name}
                  onClick={() => setColor(active ? undefined : preset.hex)}
                />
              )
            })}
            <button
              type="button"
              className={`container-swatch container-swatch-none${color ? '' : ' is-active'}`}
              title="No colour"
              aria-label="No colour"
              onClick={() => setColor(undefined)}
            >
              ∅
            </button>
          </div>
          <div className="container-modal-custom">
            <input
              value={color ?? ''}
              // Kept as typed while the user is halfway through a hex value; validated on save.
              onChange={(e) => setColor(e.target.value.trim() || undefined)}
              placeholder="#f43f5e"
              spellCheck={false}
            />
            <span
              className="container-modal-preview"
              style={
                normaliseHexColor(color)
                  ? {
                      boxShadow: `inset 0 0 0 1px ${normaliseHexColor(color)}, inset 0 0 14px -6px ${normaliseHexColor(color)}`
                    }
                  : undefined
              }
            >
              aura
            </span>
          </div>
        </div>

        <div className="container-modal-field">
          <span>Google account</span>
          {/* Chips rather than a native select: the OS dropdown ignores every colour in this app. */}
          <div className="container-modal-accounts">
            {accounts.map((account) => (
              <button
                key={account.id}
                type="button"
                className={`container-account-chip${accountId === account.id ? ' is-active' : ''}`}
                onClick={() => setAccountId(account.id)}
                title={`Sign this container into ${account.label}`}
              >
                {account.label}
              </button>
            ))}
          </div>
          <span className="container-modal-note">
            {tabCount > 0
              ? `${tabCount} open tab${tabCount === 1 ? '' : 's'} in this container. A new account applies to tabs opened from now on — a live tab keeps the store it was created with.`
              : 'Tabs opened in this container sign into that account and nothing else.'}
          </span>
        </div>

        {error && <div className="container-modal-error">{error}</div>}

        <div className="container-modal-actions">
          {isEditing && !isDefault && (
            <button type="button" className="container-modal-danger" onClick={() => void remove()} disabled={busy}>
              Delete
            </button>
          )}
          <div className="container-modal-spacer" />
          <button type="button" className="container-modal-cancel" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="container-modal-save" onClick={() => void submit()} disabled={busy}>
            {busy ? 'Saving…' : isEditing ? 'Save' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  )
}
