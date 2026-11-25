import type { ReactElement } from 'react'
import ShortcutKeys from './ShortcutKeys'

interface Props {
  /** The active tab's accent, when it has one — the button wears it. */
  accent?: string
  hasCustomColors: boolean
  onClick: () => void
  /**
   * `tile` = the full-width 2-up quick-action grid; `half` = one cell of a 2-column footer grid,
   * stacked like its neighbours so the label and the key chips line up with Files / Folder /
   * Skills / Base; `compact` = a top-bar icon button.
   */
  variant?: 'tile' | 'half' | 'compact'
  disabled?: boolean
  className?: string
  /**
   * A collapsed sidebar tile: the label row keeps the swatch/glyph and loses the words, exactly like
   * its neighbours (Files, Folder, Skills, Base). Layout is unchanged — only the text goes.
   */
  collapsed?: boolean
}

const PaletteGlyph = (): ReactElement => (
  <svg
    width="13"
    height="13"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className="shrink-0"
    aria-hidden="true"
  >
    <circle cx="12" cy="12" r="9" />
    <circle cx="12" cy="9" r="1.6" fill="currentColor" stroke="none" />
    <circle cx="15.5" cy="13" r="1.6" fill="currentColor" stroke="none" />
    <circle cx="9" cy="14.5" r="1.6" fill="currentColor" stroke="none" />
  </svg>
)

/**
 * Entry point to the per-tab accent & aura picker. Appears twice on purpose: beside the
 * conversation title in the title bar, and beside Agent Handoff / Files / Folder / Skills —
 * the colour of a tab is a property of the thing the title names, so it belongs next to it.
 */
export default function TabColorButton({
  accent,
  hasCustomColors,
  onClick,
  variant = 'tile',
  disabled = false,
  className = '',
  collapsed = false
}: Props): ReactElement {
  const tint = hasCustomColors && accent ? accent : undefined
  const base = 'transition-colors flex items-center justify-center gap-1.5 cursor-pointer border'
  const skin = disabled
    ? 'opacity-40 cursor-not-allowed bg-(--surface2) text-(--text2) border-white/5'
    : 'bg-(--surface2) hover:bg-(--border) text-(--text) border-white/10'

  if (variant === 'compact') {
    return (
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        data-tab-color-button="compact"
        title={
          disabled
            ? 'Open a tab first'
            : hasCustomColors
              ? 'This tab has its own accent & aura — change them'
              : 'Give this tab its own accent & aura colour'
        }
        aria-label="Tab accent and aura colours"
        className={`${base} ${skin} px-2.5 py-1.5 rounded-lg ${className}`}
        style={tint ? { color: tint, borderColor: `${tint}66`, boxShadow: `0 0 10px ${tint}33` } : undefined}
      >
        <PaletteGlyph />
        <span className="hidden md:inline text-xs">Colour</span>
      </button>
    )
  }

  if (variant === 'half') {
    return (
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        data-tab-color-button="half"
        title={
          disabled
            ? 'Open a tab first'
            : hasCustomColors
              ? 'This tab has its own accent & aura — change them'
              : 'Give this tab its own accent & aura colour'
        }
        aria-label="Tab accent and aura colours"
        className={`${base} ${skin} min-w-0 px-2 py-1.5 rounded-lg flex-col items-stretch justify-center gap-1 ${className}`}
        style={tint ? { color: tint, borderColor: `${tint}66`, boxShadow: `inset 0 0 12px ${tint}22` } : undefined}
      >
        <span className={`flex items-center gap-1.5 min-w-0${collapsed ? ' justify-center' : ''}`}>
          <PaletteGlyph />
          {!collapsed && (
            <span className="text-[11px] font-semibold truncate min-w-0 flex-1 text-left">
              Tab Colours
            </span>
          )}
          {hasCustomColors && (
            <span
              className="w-2 h-2 rounded-full shrink-0"
              style={{ background: tint ?? 'var(--accent)', boxShadow: `0 0 6px ${tint ?? 'var(--accent)'}` }}
              aria-hidden="true"
            />
          )}
        </span>
        <ShortcutKeys action="tab-colours" className="is-block" />
      </button>
    )
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      data-tab-color-button="tile"
      title={
        disabled
          ? 'Open a tab first'
          : hasCustomColors
            ? 'This tab has its own accent & aura — change them'
            : 'Give this tab its own accent & aura colour'
      }
      aria-label="Tab accent and aura colours"
      className={`${base} ${skin} px-2 py-1.5 rounded-lg col-span-2 ${className}`}
      style={
        tint
          ? { color: tint, borderColor: `${tint}66`, boxShadow: `inset 0 0 12px ${tint}22` }
          : undefined
      }
    >
      <PaletteGlyph />
      <span className="text-[11px] font-semibold truncate">Tab Colours</span>
      <ShortcutKeys action="tab-colours" />
      {hasCustomColors && (
        <span
          className="w-2 h-2 rounded-full shrink-0"
          style={{ background: tint ?? 'var(--accent)', boxShadow: `0 0 6px ${tint ?? 'var(--accent)'}` }}
          aria-hidden="true"
        />
      )}
    </button>
  )
}
