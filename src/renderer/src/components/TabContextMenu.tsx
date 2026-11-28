import { useEffect, useRef, type ReactElement } from 'react'

/**
 * The right-click menu for a tab.
 *
 * Right-click used to toggle pin, and nothing else: a tab could be pinned, but it could not be renamed
 * away from a page title, reloaded without switching to it and back, copied, reordered to the top, or
 * closed along with the tabs below it. This is the whole list in one place, drawn with the app's own
 * palette rather than the browser's default menu, so it reads like the rest of the sidebar.
 */
export interface TabMenuItem {
  /** Stable id, used by the tests and for de-duplication. */
  id: string
  label: string
  /** A second line for items whose effect is not obvious. */
  hint?: string
  onSelect: () => void
  /** Red label, for the items that close things. */
  danger?: boolean
  disabled?: boolean
  /** Draw a hairline above this item. */
  separatorBefore?: boolean
}

interface Props {
  x: number
  y: number
  items: TabMenuItem[]
  onClose: () => void
}

const MENU_WIDTH = 232
const MENU_MARGIN = 8

export default function TabContextMenu({ x, y, items, onClose }: Props): ReactElement {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const close = (): void => onClose()
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        close()
      }
    }
    // A menu that stays open while the list scrolls under it is worse than no menu: it points at the
    // wrong row. Dismiss on anything that moves the anchor.
    window.addEventListener('mousedown', close, true)
    window.addEventListener('resize', close)
    window.addEventListener('blur', close)
    window.addEventListener('keydown', onKey, true)
    const scroller = ref.current?.closest('[data-tab-scroller]') as HTMLElement | null
    scroller?.addEventListener('scroll', close, { passive: true })
    return () => {
      window.removeEventListener('mousedown', close, true)
      window.removeEventListener('resize', close)
      window.removeEventListener('blur', close)
      window.removeEventListener('keydown', onKey, true)
      scroller?.removeEventListener('scroll', close)
    }
  }, [onClose])

  // Keep the menu inside the window: a right-click near the bottom edge used to draw half a menu.
  const height = items.length * 30 + 16
  const left = Math.max(MENU_MARGIN, Math.min(x, window.innerWidth - MENU_WIDTH - MENU_MARGIN))
  const top = Math.max(MENU_MARGIN, Math.min(y, window.innerHeight - height - MENU_MARGIN))

  return (
    <div
      ref={ref}
      role="menu"
      aria-label="Tab actions"
      data-testid="tab-context-menu"
      onMouseDown={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
      style={{
        position: 'fixed',
        left,
        top,
        width: MENU_WIDTH,
        zIndex: 10000,
        padding: '6px',
        borderRadius: 10,
        background: 'linear-gradient(160deg, rgba(20, 26, 44, 0.98), rgba(12, 16, 28, 0.99))',
        border: '1px solid rgba(255, 255, 255, 0.09)',
        boxShadow: '0 18px 40px rgba(0, 0, 0, 0.65), inset 0 1px 0 rgba(255, 255, 255, 0.06)',
        backdropFilter: 'blur(18px)',
        userSelect: 'none'
      }}
    >
      {items.map((item) => (
        <div key={item.id}>
          {item.separatorBefore && (
            <div
              aria-hidden="true"
              style={{ height: 1, margin: '5px 6px', background: 'rgba(255, 255, 255, 0.07)' }}
            />
          )}
          <button
            type="button"
            role="menuitem"
            data-menu-action={item.id}
            disabled={item.disabled}
            onClick={() => {
              if (item.disabled) return
              onClose()
              item.onSelect()
            }}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'flex-start',
              gap: 1,
              width: '100%',
              padding: '6px 10px',
              borderRadius: 7,
              border: 'none',
              background: 'transparent',
              color: item.disabled
                ? 'rgba(136, 153, 170, 0.45)'
                : item.danger
                  ? '#f87171'
                  : '#e8edf6',
              font: '500 12.5px/1.25 system-ui, -apple-system, "Segoe UI", sans-serif',
              textAlign: 'left',
              cursor: item.disabled ? 'default' : 'pointer',
              transition: 'background 120ms ease'
            }}
            onMouseEnter={(event) => {
              if (!item.disabled) event.currentTarget.style.background = 'rgba(255, 255, 255, 0.07)'
            }}
            onMouseLeave={(event) => {
              event.currentTarget.style.background = 'transparent'
            }}
          >
            <span>{item.label}</span>
            {item.hint && (
              <span style={{ font: '500 10.5px/1.2 system-ui, sans-serif', color: '#8899aa' }}>
                {item.hint}
              </span>
            )}
          </button>
        </div>
      ))}
    </div>
  )
}
