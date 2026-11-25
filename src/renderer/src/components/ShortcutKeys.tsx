import React from 'react'
import { getShortcutKeys } from '../lib/shortcuts'

/**
 * The keys that do the same thing as the button next to them.
 *
 * Every tool in the sidebar footer had its shortcut in a `title` attribute, which is a tooltip you have
 * to go looking for. Remembering "Files is Ctrl+O" is the whole point of a shortcut, so the keys are now
 * printed on the button itself, in the same monospace chip the Container digit uses. They come from the
 * same keymap the shortcuts are matched against, so a customised shortcut shows up here too — a badge
 * that lied about the key would be worse than no badge.
 */

const SYMBOLS: Record<string, string> = {
  Ctrl: 'Ctrl',
  Cmd: '⌘',
  Meta: '⌘',
  Alt: 'Alt',
  Shift: '⇧',
  Enter: '⏎',
  Escape: 'Esc'
}

function displayKey(key: string): string {
  return SYMBOLS[key] || key
}

export interface ShortcutKeysProps {
  /** Action id from `DEFAULT_SHORTCUTS` — the same id the keymap uses. */
  action: string
  /** Hide the plus signs; a chip per key reads better in a narrow button. */
  className?: string
  style?: React.CSSProperties
  /** Render nothing when the action has no keys (rather than an empty chip). */
  hideWhenEmpty?: boolean
}

export const ShortcutKeys: React.FC<ShortcutKeysProps> = ({
  action,
  className = '',
  style,
  hideWhenEmpty = true
}) => {
  const keys = getShortcutKeys(action)
  if (!keys || keys.length === 0) {
    return hideWhenEmpty ? null : <span className={className} style={style} />
  }

  return (
    <span
      className={`shortcut-keys ${className}`}
      style={style}
      title={keys.join('+')}
      aria-label={`Shortcut: ${keys.join(' plus ')}`}
      data-shortcut-for={action}
    >
      {keys.map((key, index) => (
        <kbd key={`${key}-${index}`} className="shortcut-key">
          {displayKey(key)}
        </kbd>
      ))}
    </span>
  )
}

export default ShortcutKeys
