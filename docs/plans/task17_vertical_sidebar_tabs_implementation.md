# Task 17: Vertical Sidebar Tabs Implementation

## 1. Context & Objective
Transform the browser layout to use vertical tabs in a modern sidebar format, fulfilling the user's specific answers:
- **Collapsed Sidebar**: When collapsed, do **not** show icons only; show the **first 3 to 5 words of the tab title** in a compact text chip/pill (width ~160px-180px).
- **Expanded Sidebar**: Width ~240px-260px, showing full tab title, provider badge, Herdr status indicator, and close button on hover.
- **Pinned Tabs**: Preserved in the bottom dock (`interfaceSettings.pinnedPosition === 'bottom'`) for immediate multi-model switching.

## 2. Component Design: `VerticalTabs.tsx`
A dedicated modern vertical tab strip supporting:
1. **Word-count smart truncation**:
   - Helper function `formatCollapsedTitle(title: string, wordCount: number = 4): string`
   - Splits on whitespace, extracts the first 3-5 words, and appends ellipsis if truncated.
   - Guaranteed nowrap and shrink-resistant styling per `ui-ux-pro-max` compact label guidelines.
2. **Tab Row Layout**:
   - Provider brand icon with model accent glow.
   - Herdr status indicator (pulsing amber dot when waiting for input, spinning ring when working, subtle dot when idle).
   - Tab title (first 3-5 words in collapsed mode, full title with truncation in expanded mode).
   - Close (`×`) button appearing on hover/active.
   - Keyboard navigation (`ArrowUp`, `ArrowDown`, `Home`, `End`, `Enter`).
3. **Sidebar Header**:
   - Nexus logo & sidebar collapse/expand toggle button.
   - New Tab (+) button with quick AI model selector dropdown.
   - Omni-search button (`Ctrl+L` / Search) to open URL / query launcher.
4. **Sidebar Footer**:
   - Relocated actions:
     - `HudStatusHeader` (JARVIS HUD & Audio)
     - `Agent Handoff` Export button
     - `Tab Overview` button
     - `History` button
     - `Settings` button

## 3. Safe File-Writing Protocol
- Maintain `_gemini` copies for any modified components.
- Confirm existing behavior of active tab switching, tab closing, MRU order, and right-click pin toggling.
