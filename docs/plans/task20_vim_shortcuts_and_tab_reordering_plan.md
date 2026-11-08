# Task 20: Vim Shortcuts & Tab Reordering (Keyboard + Mouse Drag-and-Drop)

## 1. Context & Objective
The user specified:
1. `Ctrl+J` goes down (switches to the tab below, index + 1).
2. `Ctrl+K` goes up (switches to the tab above, index - 1).
3. `Ctrl+Shift+J` moves the active tab down (swaps with tab below).
4. `Ctrl+Shift+K` moves the active tab up (swaps with tab above).
5. Mouse drag-and-drop reordering: allow reordering vertical tabs by dragging them directly with the mouse.

## 2. Shortcut Key Mapping
Update `src/renderer/src/lib/shortcuts.ts` and `src/main/index.ts`:
- `tab-prev` (Go Up): `['Ctrl', 'K']`
- `tab-next` (Go Down): `['Ctrl', 'J']`
- `tab-move-down` (Move Tab Down): `['Ctrl', 'Shift', 'J']`
- `tab-move-up` (Move Tab Up): `['Ctrl', 'Shift', 'K']`

## 3. Reordering Logic (`tabs.ts` & `App.tsx`)
- Implement `moveTab(tabs: Tab[], id: string, direction: 'up' | 'down'): Tab[]`:
  - Finds the tab's current index within regular unpinned tabs.
  - If moving up and `idx > 0`, swaps `idx` with `idx - 1`.
  - If moving down and `idx < length - 1`, swaps `idx` with `idx + 1`.
  - Preserves the tab array and syncs to disk (`save_state`).
- Implement `reorderTabs(tabs: Tab[], sourceId: string, targetId: string): Tab[]`:
  - Used for mouse drag-and-drop.
  - Re-inserts `sourceId` before or after `targetId`.

## 4. Mouse Drag-and-Drop in `VerticalTabs.tsx`
- HTML5 Drag and Drop attributes on each tab pill:
  - `draggable={true}`
  - `onDragStart={(e) => e.dataTransfer.setData('text/plain', tab.id)}`
  - `onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move' }}`
  - `onDrop={(e) => { const sourceId = e.dataTransfer.getData('text/plain'); onReorder(sourceId, tab.id) }}`
- Visual indicator showing drag destination line with accent glow.

## 5. Verification Plan
- Unit tests for `moveTab` and `reorderTabs` in `tabs.test.ts`.
- Component tests for mouse drag events in `VerticalTabs.test.tsx`.
