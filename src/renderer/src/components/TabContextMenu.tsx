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
    // Dismiss on a press anywhere that is not the menu itself.
    //
    // This was the build-47 bug, and it made every single item dead: the dismissal listened in the
    // *capture* phase on `window`, so it ran before the button under the pointer ever saw the press. The
    // menu was removed from the DOM between `mousedown` and `mouseup`, the button never received a
    // `click`, and nothing the user picked did anything at all. The listener now stays out of the way of
    // presses that land inside the menu; `stopPropagation` in the menu's own handler is not enough,
    // because capture-phase listeners run first by definition.
    const onPointerDown = (event: MouseEvent): void => {
      // `instanceof` rather than a cast: a press dispatched on `window` itself (which is what a
      // dismissal test does, and what a synthetic close looks like) has a target that is not a Node, and
      // asking `contains()` about it throws — which would leave the menu open instead of closing it.
      const target = event.target
      if (target instanceof Node && ref.current && ref.current.contains(target)) return
      close()
    }
    window.addEventListener('mousedown', onPointerDown, true)
    window.addEventListener('resize', close)
    window.addEventListener('blur', close)
    window.addEventListener('keydown', onKey, true)
    const scroller = ref.current?.closest('[data-tab-scroller]') as HTMLElement | null
    scroller?.addEventListener('scroll', close, { passive: true })
    return () => {
      window.removeEventListener('mousedown', onPointerDown, true)
      window.removeEventListener('resize', close)
      window.removeEventListener('blur', close)
      window.removeEventListener('keydown', onKey, true)
      scroller?.removeEventListener('scroll', close)
    }
  }, [onClose])

  // Keep the menu inside the window, and — the part that decides whether it is clickable at all — inside
  // the sidebar. The AI view is a native view drawn *over* the renderer, so any part of this menu that
  // spills past the sidebar's right edge is covered by the page and cannot be pressed. Clamping to the
  // tab list's own box means every item is always reachable.
  const height = items.length * 30 + 16
  let maxRight = window.innerWidth
  try {
    const scroller = document.querySelector('[data-tab-scroller]')
    const rect = scroller?.getBoundingClientRect()
    if (rect && rect.width > 0) maxRight = Math.min(maxRight, rect.right)
  } catch {
    /* no tab list on screen: the window is the bound */
  }
  const left = Math.max(
    MENU_MARGIN,
    Math.min(x, Math.max(MENU_MARGIN, maxRight - MENU_WIDTH - MENU_MARGIN))
  )
  const top = Math.max(MENU_MARGIN, Math.min(y, window.innerHeight - height - MENU_MARGIN))

  return (
    <div
      ref={ref}
      role="menu"
      aria-label="Tab actions"
      data-testid="tab-context-menu"
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
