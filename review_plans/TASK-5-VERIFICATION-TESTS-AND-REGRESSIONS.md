# Task 5: Automated Test Suite, CSS Assertion & Migration Matrix

**Target Files:**
- `src/renderer/src/components/TitlebarModelPillar.test.tsx` (New component tests)
- `src/renderer/src/components/WindowTitleBar.test.tsx` (Updated titlebar tests)
- `src/renderer/src/lib/models.test.ts` (New 5-case migration test matrix)

---

## 1. Problem Statement & Audit Findings

1. **Class Name Proxy instead of CSS Invariant (Finding H5):**
   - Asserting `className.includes('no-drag')` was a fragile proxy. If the CSS property `-webkit-app-region: no-drag !important` was deleted from the stylesheet, the test would still pass while clicks broke on Linux. The test must parse and assert the actual CSS declaration.
2. **Untested Data Migration Footgun (Finding H6):**
   - The user-data migration had zero tests. It requires an explicit 5-case test suite covering legacy upgrade, custom model preservation, key collision, corrupt data recovery, and deletion persistence.
3. **App Import Pollution & Typecheck Failures (Findings M4, M5, M9):**
   - Tests imported `DEFAULT_MODELS` from `App.tsx`, pulling Electron IPC and webviews into jsdom. `DEFAULT_MODELS` must be imported from the leaf `models.ts`.
   - `vi.useFakeTimers()` leaked when assertions failed; timer advances must be wrapped in `act()`.
   - `WindowTitleBar` test fixtures omitted required props, failing TypeScript checks.

---

## 2. Specification & Implementation Details

### 2.1. Leaf Module Import & CSS Invariant Assertion (`TitlebarModelPillar.test.tsx`) (Findings H5, M5)

```tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { TitlebarModelPillar } from './TitlebarModelPillar'
import { DEFAULT_MODELS } from '../lib/models' // Clean leaf import!

describe('TitlebarModelPillar Component', () => {
  it('renders all configured default AI providers with correct aria-checked', () => {
    const onSelect = vi.fn()
    render(
      <TitlebarModelPillar
        models={DEFAULT_MODELS}
        activeModelKey="claude"
        onSelectModel={onSelect}
      />
    )

    const claudeBtn = screen.getByRole('radio', { name: /claude/i })
    expect(claudeBtn.getAttribute('aria-checked')).toBe('true')
    expect(claudeBtn.tabIndex).toBe(0) // Roving tabindex active

    const chatgptBtn = screen.getByRole('radio', { name: /chatgpt/i })
    expect(chatgptBtn.getAttribute('aria-checked')).toBe('false')
    expect(chatgptBtn.tabIndex).toBe(-1) // Roving tabindex inactive
  })

  it('navigates via arrow keys with roving tabindex', () => {
    const onSelect = vi.fn()
    render(
      <TitlebarModelPillar
        models={DEFAULT_MODELS}
        activeModelKey="chatgpt"
        onSelectModel={onSelect}
      />
    )

    const container = screen.getByRole('radiogroup')
    fireEvent.keyDown(container, { key: 'ArrowRight' })
    expect(onSelect).toHaveBeenCalledWith('claude') // Next model
  })

  // Finding H5: Parse actual CSS stylesheet to verify -webkit-app-region invariant!
  it('strictly defines -webkit-app-region: no-drag !important in TitlebarModelPillar.css', () => {
    const cssPath = resolve(__dirname, './TitlebarModelPillar.css')
    const cssContent = readFileSync(cssPath, 'utf-8')

    // Regex check for both container and pill rules
    expect(cssContent).toMatch(/\.titlebar-model-pillar[\s\S]*?-webkit-app-region:\s*no-drag\s*!important;/)
    expect(cssContent).toMatch(/\.titlebar-model-pill[\s\S]*?-webkit-app-region:\s*no-drag\s*!important;/)
  })
})
```

### 2.2. The 5-Case LocalStorage Migration Matrix (`models.test.ts`) (Finding H6)

```tsx
import { describe, it, expect, beforeEach } from 'vitest'
import {
  loadAndMigrateModels,
  DEFAULT_MODELS,
  STORAGE_KEY,
  LEGACY_STORAGE_KEY,
  SCHEMA_KEY
} from './models'

describe('Models LocalStorage Migration Matrix (Finding H6)', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  // Case 1: Fresh Install
  it('Case 1: Fresh install initializes default models and sets schema version = 2', () => {
    const result = loadAndMigrateModels(DEFAULT_MODELS)
    expect(result.length).toBe(DEFAULT_MODELS.length)
    expect(localStorage.getItem(SCHEMA_KEY)).toBe('2')
    expect(localStorage.getItem(STORAGE_KEY)).not.toBeNull()
  })

  // Case 2: Legacy v1 Upgrade (Missing ChatGPT & Claude)
  it('Case 2: Legacy v1 upgrade appends missing ChatGPT and Claude while preserving order', () => {
    const legacyData = [
      { key: 'gemini', label: 'Gemini', url: 'https://gemini.google.com' },
      { key: 'deepseek', label: 'DeepSeek', url: 'https://chat.deepseek.com' }
    ]
    localStorage.setItem(LEGACY_STORAGE_KEY, JSON.stringify(legacyData))
    // schema key is unset (version 0)

    const result = loadAndMigrateModels(DEFAULT_MODELS)
    expect(result[0].key).toBe('gemini')
    expect(result[1].key).toBe('deepseek')
    expect(result.some((m) => m.key === 'chatgpt')).toBe(true)
    expect(result.some((m) => m.key === 'claude')).toBe(true)
    expect(localStorage.getItem(SCHEMA_KEY)).toBe('2')
  })

  // Case 3: Preserves User Custom Models & Respects Key Collisions
  it('Case 3: Preserves user custom models and never clobbers custom chatgpt key', () => {
    const customModels = [
      { key: 'chatgpt', label: 'My Custom ChatGPT Team', url: 'https://custom.chatgpt.com' },
      { key: 'local-llm', label: 'Ollama Local', url: 'http://localhost:11434' }
    ]
    localStorage.setItem(LEGACY_STORAGE_KEY, JSON.stringify(customModels))

    const result = loadAndMigrateModels(DEFAULT_MODELS)
    const customChatgpt = result.find((m) => m.key === 'chatgpt')
    expect(customChatgpt?.label).toBe('My Custom ChatGPT Team') // Stored wins!
    expect(result.some((m) => m.key === 'local-llm')).toBe(true)
  })

  // Case 4: Deliberate Deletion Persistence (Fixing Finding B4)
  it('Case 4: Respects deliberate deletions of models when schema is already v2', () => {
    // User migrated to v2, then explicitly deleted chatgpt and claude
    const userTrimmed = [
      { key: 'gemini', label: 'Gemini', url: 'https://gemini.google.com' }
    ]
    localStorage.setItem(STORAGE_KEY, JSON.stringify(userTrimmed))
    localStorage.setItem(SCHEMA_KEY, '2') // Schema is already 2!

    const result = loadAndMigrateModels(DEFAULT_MODELS)
    expect(result.length).toBe(1)
    expect(result[0].key).toBe('gemini')
    expect(result.some((m) => m.key === 'chatgpt')).toBe(false) // DOES NOT resurrect!
  })

  // Case 5: Corrupt JSON Recovery & Quarantine
  it('Case 5: Corrupted storage is quarantined without crashing and defaults restored', () => {
    const corrupted = 'INVALID_JSON_CORRUPTED{{{}}'
    localStorage.setItem(STORAGE_KEY, corrupted)

    const result = loadAndMigrateModels(DEFAULT_MODELS)
    expect(result.length).toBe(DEFAULT_MODELS.length)
    expect(localStorage.getItem(SCHEMA_KEY)).toBe('2')

    // Verified that quarantine key was written
    const keys = Object.keys(localStorage)
    expect(keys.some((k) => k.startsWith('nexus.models.corrupted.'))).toBe(true)
  })
})
```

### 2.3. Auto-Hide Window State Machine (`WindowTitleBar.test.tsx`) (Findings M4, M9)

```tsx
import { render, screen, fireEvent, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { WindowTitleBar } from './WindowTitleBar'
import { DEFAULT_MODELS } from '../lib/models'

describe('WindowTitleBar Auto-Hide Engine', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  it('renders inert attribute when retracted in autoHideMode', () => {
    const { container } = render(
      <WindowTitleBar
        autoHideMode={true}
        models={DEFAULT_MODELS}
        activeModelKey="gemini"
        onSelectModel={() => {}}
      />
    )
    const header = container.querySelector('header')!
    expect(header.getAttribute('inert')).toBe('')
  })

  it('reveals titlebar after 150ms dwell and cancels inert', () => {
    const { container } = render(
      <WindowTitleBar
        autoHideMode={true}
        models={DEFAULT_MODELS}
        activeModelKey="gemini"
        onSelectModel={() => {}}
      />
    )
    const header = container.querySelector('header')!

    // Mouse enters top 4px
    act(() => {
      window.dispatchEvent(new MouseEvent('mousemove', { clientY: 2 }))
    })

    // Before dwell ends: still retracted
    expect(header.className).not.toContain('revealed')

    // After 150ms dwell: reveals
    act(() => {
      vi.advanceTimersByTime(160)
    })
    expect(header.className).toContain('revealed')
    expect(header.getAttribute('inert')).toBeNull()
  })
})
```

---

## 3. Execution & Verification Commands

```bash
# 1. Typecheck the entire project
npm run typecheck

# 2. Run new migration and component suites
npx vitest run src/renderer/src/lib/models.test.ts
npx vitest run src/renderer/src/components/TitlebarModelPillar.test.tsx
npx vitest run src/renderer/src/components/WindowTitleBar.test.tsx

# 3. Full project regression suite
npm test

# 4. Production compilation test
npm run build
```

---

## 4. Acceptance Criteria
- [ ] 100% of the 5 migration scenarios pass without warnings.
- [ ] CSS parser verifies `-webkit-app-region: no-drag !important` presence.
- [ ] Auto-hide dwell timer and `inert` attribute verified.
- [ ] Zero TypeScript errors across node and web targets.
