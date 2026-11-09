# Task 40: Accurate Ctrl+Number & Ctrl+Tab Navigation Plan

> **For Antigravity:** REQUIRED SUB-SKILL: Load executing-plans to implement this plan task-by-task.

**Goal:** Make `Ctrl+1, 2, 3, 4`, `Ctrl+9`, and `Ctrl+Tab` / `Ctrl+Shift+Tab` 100% accurate by binding them directly to visual sidebar tab order, detecting physical keycodes (`Digit1..9` and `Numpad1..9`) across international layouts, eliminating the MRU ping-pong trap, and auto-focusing the prompt composer upon switching.

**Architecture:** Main-process `routeGlobalShortcut` intercepts physical `Digit1..9`, `Numpad1..9`, and `Tab` from both window and webviews. Renderer resolves tabs against `getOrderedVisualTabs(...)` matching the exact sequence displayed in `VerticalTabs.tsx`. `Ctrl+Tab` cycles forward visually and `Ctrl+Shift+Tab` cycles backward. Lightweight overlays are dismissed and the prompt input is focused immediately.

**Tech Stack:** Electron `before-input-event`, Chromium physical keycodes, React 19, TypeScript, Vitest.

---

### Task 40.1: Visual Tab Order Resolution Helper & Tests
**Files:**
- Modify: `src/renderer/src/lib/tabs.ts`
- Modify: `src/renderer/src/lib/tabs_gemini.ts`
- Test: `src/renderer/src/lib/visualTabShortcuts.test.ts`
- Test: `src/renderer/src/lib/visualTabShortcuts_gemini.test.ts`

**Step 1: Write test for visual tab order resolution and sequential cycling**
- Verify `getOrderedVisualTabs` returns tabs matching the visual sequence (active pinned first, active unpinned second, sleeping tabs third).
- Verify `Ctrl+1..4` resolves to index 0..3 of the visual list.
- Verify `Ctrl+9` (index `-1`) resolves to the last tab in the visual list.
- Verify `getNextVisualTab` cycles forward ($1 \to 2 \to 3 \to 4 \to 1$) and backward with shift ($1 \to 4 \to 3 \to 2 \to 1$) without getting stuck.

**Step 2: Implement `getOrderedVisualTabs` and `getNextVisualTab` in `tabs.ts`**
- Export `getOrderedVisualTabs` and `getNextVisualTab` matching `VerticalTabs` ordering logic.

---

### Task 40.2: Main Process Physical Keycode Interception & Routing
**Files:**
- Modify: `src/main/index.ts`
- Modify: `src/main/index_gemini.ts`
- Test: `src/main/shortcutRouting.test.ts`

**Step 1: Write unit tests for physical keycode detection**
- Test `routeGlobalShortcut` with `input.code = 'Digit1'`, `'Digit4'`, `'Digit9'`, `'Numpad1'`, `'Tab'`, and `'Tab'` with shift.

**Step 2: Update `routeGlobalShortcut` in `src/main/index.ts`**
- Check `input.code` for `Digit1..9` and `Numpad1..9` alongside `input.key`.
- Map 9 to index `-1` (last tab).
- Catch `Ctrl+Tab` and `Ctrl+Shift+Tab` cleanly via `input.code === 'Tab'`.

---

### Task 40.3: Renderer Integration, Auto-Dismiss Overlays, and Composer Auto-Focus
**Files:**
- Modify: `src/renderer/src/App.tsx`
- Modify: `src/renderer/src/App_gemini.tsx`

**Step 1: Update `switch_tab_index` in `App.tsx`**
- Use `getOrderedVisualTabs` to find target tab.
- If target exists, dismiss lightweight overlays (`showUrlBar`, `showTabOverview`, `showNewTab`).
- Switch to tab, trigger audio pop (`sfx.pop()`), and auto-focus composer.

**Step 2: Update `handleTabCycleIPC` in `App.tsx`**
- Replace flawed MRU toggle with `getNextVisualTab`.
- Smoothly cycle forward on `Ctrl+Tab` and backward on `Ctrl+Shift+Tab`.
- Auto-focus composer upon cycle.

---

### Task 40.4: Verification & Automated Tests
**Files:**
- Run: `npm test -- src/renderer/src/lib/visualTabShortcuts.test.ts`
- Run: `npm test -- src/main/shortcutRouting.test.ts`
- Run: `npm test`
- Run: `npm run typecheck`
- Run: `npm run build`
