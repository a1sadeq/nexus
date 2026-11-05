# Task 2: Titlebar Expanded Model Pillar, Responsive Tiers & Keyboard Contract

**Target Files:**
- `src/renderer/src/components/TitlebarModelPillar.tsx` (New Component)
- `src/renderer/src/components/TitlebarModelPillar.css` (New Stylesheet)
- `src/renderer/src/components/WindowTitleBar.tsx` (Layout & Conversation Pill)
- `src/renderer/src/App.tsx` (Semantic anchor edit to remove `ModelNotch` from tab strip)
- `src/main/index.ts` (Set `minWidth: 800` on `BrowserWindow`)

---

## 1. Problem Statement & Audit Findings

1. **Width Collapse & Window Snapping (Finding B3):**
   - The initial design had no responsive strategy. 8 buttons with full text labels require ~1300px. Snapping a 1080p window to half-screen yields 960px, causing the pillar to collide with the Windows 140px caption reserve.
2. **Inline Style Precedence Overriding CSS (Finding B5):**
   - Setting `--provider-glow: ${color}88` inline in JSX overrode the CSS stylesheet's `color-mix()` declarations. JSX must pass ONLY `--provider-color`.
3. **Accessibility & Keyboard Navigation Gap (Finding H4):**
   - Declaring `role="radiogroup"` without a keyboard contract violated WAI-ARIA. Users must be able to use Left/Right/Home/End arrow keys with a roving tabindex.
4. **Brittle Line Number Edits (Finding M8):**
   - Deletion instructions in `App.tsx` were anchored to raw line numbers rather than semantic code comments.
5. **Conversation Pill Interactivity (Finding L2):**
   - The conversation pill's hover, drag, and click semantics were ambiguous.

---

## 2. Specification & Implementation Details

### 2.1. Three-Tier Responsive Titlebar Strategy (Finding B3)

We divide the titlebar width budget into three explicit tiers using CSS media queries and container queries:

| Window Width | Responsive Tier | Model Pillar Appearance | Total Pillar Width |
| :--- | :--- | :--- | :--- |
| **≥ 1440px** | **Tier 1 (Expanded Desktop)** | Full brand icon (14px) + Uppercase label (e.g. `GEMINI`, `CLAUDE`) | ~720px |
| **1100px – 1439px** | **Tier 2 (Standard / Laptop)** | Circular Icon-only buttons (26px) + Rich HTML tooltip on hover | ~290px |
| **800px – 1099px** | **Tier 3 (Half-Snap / Compact)** | Micro Icon-only buttons (22px, 4px gap) | ~230px |

#### Width Budget Breakdown at 960px (1080p Half-Snap):
- Brand zone: 90px
- Conversation pill: 200px (truncated)
- Tier 3 Model Pillar: 230px
- Center flex slack: ~300px
- Windows caption reserve: 140px
- **Total: 960px (Zero collision, perfectly centered!).**

In `src/main/index.ts`, set:
```typescript
mainWindow = new BrowserWindow({
  width: 1280,
  height: 800,
  minWidth: 800, // Enforces Tier 3 minimum clearance
  minHeight: 500,
  // ...
})
```

### 2.2. New Component: `<TitlebarModelPillar />` (Findings B5, H4)

```tsx
import { type FC, type KeyboardEvent, useRef } from 'react'
import type { ModelDef } from '../lib/models'
import { BrandIcon } from './BrandIcons'
import './TitlebarModelPillar.css'

export interface TitlebarModelPillarProps {
  models: ModelDef[]
  activeModelKey: string
  onSelectModel: (key: string) => void
}

export const TitlebarModelPillar: FC<TitlebarModelPillarProps> = ({
  models,
  activeModelKey,
  onSelectModel
}) => {
  const buttonRefs = useRef<Map<string, HTMLButtonElement>>(new Map())

  // WAI-ARIA Roving Tabindex & Arrow Key Handler
  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const keys = models.map((m) => m.key)
    const currentIndex = keys.indexOf(activeModelKey)
    if (currentIndex === -1) return

    let nextIndex = currentIndex

    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault()
      nextIndex = (currentIndex + 1) % keys.length
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault()
      nextIndex = (currentIndex - 1 + keys.length) % keys.length
    } else if (e.key === 'Home') {
      e.preventDefault()
      nextIndex = 0
    } else if (e.key === 'End') {
      e.preventDefault()
      nextIndex = keys.length - 1
    }

    if (nextIndex !== currentIndex) {
      const nextKey = keys[nextIndex]
      onSelectModel(nextKey)
      buttonRefs.current.get(nextKey)?.focus()
    }
  }

  return (
    <div
      className="titlebar-model-pillar no-drag"
      role="radiogroup"
      aria-label="Active AI Provider Selector"
      onKeyDown={handleKeyDown}
    >
      {models.map((m) => {
        const isActive = m.key === activeModelKey
        return (
          <button
            key={m.key}
            ref={(el) => {
              if (el) buttonRefs.current.set(m.key, el)
              else buttonRefs.current.delete(m.key)
            }}
            type="button"
            role="radio"
            aria-checked={isActive}
            tabIndex={isActive ? 0 : -1} // Roving tabindex: only active is directly tabbable
            title={`${m.label} — Switch to provider`}
            className={`titlebar-model-pill no-drag ${isActive ? 'active' : ''}`}
            style={{ '--provider-color': m.color } as React.CSSProperties} // ONLY set brand color!
            onClick={() => onSelectModel(m.key)}
          >
            <BrandIcon id={m.key} size={14} className="titlebar-model-icon" />
            <span className="titlebar-model-label">{m.label}</span>
          </button>
        )
      })}
    </div>
  )
}
```

### 2.3. Responsive CSS (`TitlebarModelPillar.css`)

```css
.titlebar-model-pillar {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 6px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 999px;
  -webkit-app-region: no-drag !important;
}

.titlebar-model-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: 999px;
  border: 1px solid transparent;
  background: transparent;
  color: #94a3b8;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.3px;
  cursor: pointer;
  transition: all 0.2s ease;
  -webkit-app-region: no-drag !important;
}

/* Tier 2: 1100px - 1439px -> Icon Only */
@media (max-width: 1439px) {
  .titlebar-model-pill {
    padding: 4px;
    width: 26px;
    height: 26px;
    justify-content: center;
  }
  .titlebar-model-label {
    display: none;
  }
}

/* Tier 3: < 1100px -> Compact Icon Only */
@media (max-width: 1099px) {
  .titlebar-model-pillar {
    gap: 3px;
    padding: 2px 4px;
  }
  .titlebar-model-pill {
    width: 22px;
    height: 22px;
    padding: 2px;
  }
}
```

### 2.4. Semantic Anchor Edits in `App.tsx` (Finding M8)
Instead of relying on fragile line numbers, find the semantic block:
```tsx
{/* Center: Models (Floating on md+, inline on small) */}
```
Remove the inner `ModelNotch` wrapper entirely. The `ChatTabs` container directly receives `flex-1 w-full min-w-0 pr-4`, utilizing the full unshared width.

### 2.5. Conversation Pill Interactivity & Drag Region (Finding L2)
In `WindowTitleBar.tsx`:
- The conversation pill is a non-interactive status indicator (`role="status"`, `pointer-events-none`).
- Hover states are explicitly suppressed so it does not falsely read as a clickable button.
- It is stamped with `no-drag` so users clicking to select text or double-clicking the titlebar do not get caught in conflicting native drag handlers.

---

## 3. Verification Criteria
1. At 960px width (half-snapped 1080p), the pillar displays in Tier 3 without overflowing or overlapping the Windows caption buttons.
2. Arrow keys (Left/Right/Home/End) cycle focus and switch active models with a proper roving tabindex.
3. Every button and the pillar container are confirmed `no-drag` in CSS.
