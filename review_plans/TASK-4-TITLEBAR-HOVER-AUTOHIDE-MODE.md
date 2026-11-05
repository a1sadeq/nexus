# Task 4: Smart Hover Auto-Hide Mode with Zero-Interception & Dwell Filter

**Target Files:**
- `src/renderer/src/components/WindowTitleBar.tsx`
- `src/renderer/src/components/WindowTitleBar.css`
- `src/renderer/src/App.tsx`

---

## 1. Problem Statement & Audit Findings

1. **Tab Strip Click Interception (Finding B1):**
   - The initial design pinned a 4px tall, full-width `<div>` with `pointer-events: auto` and `z-index: 99998` over the top of the window. Because in auto-hide mode the titlebar is retracted, this transparent overlay sat directly over the top 4px of the tab strip and new-tab button, completely swallowing user clicks.
2. **Accidental Model Switching on Rapid Mouse Movement (Finding B2):**
   - Revealing the 36px titlebar with 0ms debounce meant that a user moving the pointer downward toward a tab would have the titlebar slide in underneath their moving cursor, turning intended tab clicks into accidental model switches.
3. **Focusable Off-Screen Elements & Keyboard Trap (Finding H1):**
   - An element translated off-screen with `translateY(-100%)` remains in the DOM focus order. Tabbing into the window focused invisible buttons.
4. **Windows Native Caption Button Overlay (Finding H7):**
   - Windows native `titleBarOverlay` controls are drawn by DWM/Chromium above DOM content. In auto-hide mode, the native caption buttons remain visible in the top-right corner; the floating titlebar must preserve `paddingRight: 140px` so the pillar never slides under them.
5. **Timer Hygiene & Keyboard Shortcut (Findings M6, L1):**
   - Timers must be typed `ReturnType<typeof setTimeout>` and cleaned up on unmount. Keyboard users need a hotkey (`Alt+Shift+T`) to reveal the titlebar.

---

## 2. Specification & Implementation Details

### 2.1. The Zero-Interception Window Listener Engine (Finding B1)

We **completely eliminate the overlay `<div>`**. Instead, we attach a lightweight `window` `mousemove` listener when `autoHideMode` is active.

A `mousemove` event listener on `window` **does not hit-test or swallow any click events whatsoever**:

```tsx
useEffect(() => {
  if (!autoHideMode) {
    setIsRevealed(false)
    return
  }

  let dwellTimer: ReturnType<typeof setTimeout> | null = null

  const handleMouseMove = (e: MouseEvent) => {
    // Top 4px hover zone detection
    if (e.clientY <= 4) {
      if (!isRevealed && !dwellTimer) {
        // 150ms Dwell Filter (Finding B2)
        dwellTimer = setTimeout(() => {
          setIsRevealed(true)
          dwellTimer = null
        }, 150)
      }
    } else if (e.clientY > 44 && dwellTimer) {
      // User moved away quickly: cancel dwell, do not reveal!
      clearTimeout(dwellTimer)
      dwellTimer = null
    }
  }

  window.addEventListener('mousemove', handleMouseMove, { passive: true })
  return () => {
    window.removeEventListener('mousemove', handleMouseMove)
    if (dwellTimer) clearTimeout(dwellTimer)
  }
}, [autoHideMode, isRevealed])
```

### 2.2. Dwell Timer & 300ms Leave Grace Period (Findings B2, M6)

1. **Enter:** The user's cursor touches `clientY <= 4`. If the cursor stays for ≥ 150ms (intentional gesture), the titlebar reveals. If the user was just flicking their cursor to a tab, the dwell cancels and the tab receives the click with 0 interference.
2. **Leave:** When the cursor leaves the revealed `<header>`, a 300ms grace period runs before retracting, ensuring smooth clicks on caption buttons or dropdown menus.
3. **Cleanup:** All timers use `ReturnType<typeof setTimeout>` and are cleared on component unmount.

### 2.3. Keyboard Accessibility & `inert` Attribute (Findings H1, L1)

1. **`inert` Attribute:** When `autoHideMode` is active and `!isRevealed`, the `<header>` element receives `inert={true}` (supported natively in Chromium 102+). This completely excludes off-screen buttons from keyboard Tab navigation and screen-reader accessibility trees.
2. **Keyboard Toggle Shortcut:** Pressing `Alt+Shift+T` immediately toggles `isRevealed` for keyboard-only users.

```tsx
useEffect(() => {
  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.altKey && e.shiftKey && e.key.toLowerCase() === 't') {
      e.preventDefault()
      setIsRevealed((prev) => !prev)
    }
  }
  window.addEventListener('keydown', handleKeyDown)
  return () => window.removeEventListener('keydown', handleKeyDown)
}, [])
```

### 2.4. Windows `titleBarOverlay` Coordination (Finding H7)
On Windows:
- The floating revealed titlebar preserves `paddingRight: '140px'` so its center pillar never collides with native caption controls.
- When retracted, the background of the native caption buttons blends into the window header background (`var(--bg)`).

### 2.5. CSS Architecture (`WindowTitleBar.css`)

```css
/* Standard Mode */
.nexus-inapp-titlebar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  height: 36px;
  background: var(--surface, #11151e);
  border-bottom: 1px solid var(--border, rgba(255, 255, 255, 0.08));
  position: relative;
  z-index: 50;
  user-select: none;
}

/* Auto-Hide Mode: Floating Fixed Layer */
.nexus-inapp-titlebar.autohide {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 99999;
  transform: translateY(-100%);
  transition: transform 250ms cubic-bezier(0.16, 1, 0.3, 1), box-shadow 250ms ease;
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.6);
  visibility: hidden; /* Hidden when retracted */
}

/* Revealed on Intentional Dwell or Hotkey */
.nexus-inapp-titlebar.autohide.revealed {
  transform: translateY(0);
  visibility: visible;
}
```

---

## 3. Verification Criteria
1. Full tab strip area receives 100% of mouse clicks with zero interception in auto-hide mode.
2. Transiting the mouse quickly over the top 4px does NOT reveal the titlebar (150ms dwell required).
3. Pressing `Tab` while retracted does NOT focus hidden provider buttons (`inert` confirmed).
4. `Alt+Shift+T` instantly reveals the titlebar and places focus on the active provider button.
