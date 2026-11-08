# Task 26 Plan: Vertical Tabs Active vs Discarded Separation & Arc-Reactor Cockpit Styling

## 1. Context and Problem Statement
1. **Unsegmented Tab List:**
   - In the vertical tabs sidebar, all tabs are mixed together in a single flat list. Users cannot distinguish between tabs that are resident in memory / actively running and tabs that have been discarded / hibernated to save system resources.
2. **Underemphasized Active Tabs:**
   - Active tabs use small typography and minimal borders, lacking distinction from idle or sleeping tabs.
3. **Active Tab Lacks Spatial Cockpit Polish:**
   - The focused active tab does not match the visual appeal of the AI models pillar at the top (`TitlebarModelPillar`), which features arc-reactor gradient borders, active-core pulsing dots with radar ripple, and ambient glow.

## 2. Requirements & Desired Behavior
1. **Partitioning into Active vs Sleeping / Discarded:**
   - Group tabs into two distinct visual sections:
     - **Active Sessions:** Resident views in memory, the currently focused active tab, and any tab with active AI status (`working`, `waiting_input`).
     - **Sleeping / Discarded Sessions:** Evicted/hibernated tabs that have been discarded from memory to save CPU and RAM.
2. **Top Section: Active Sessions:**
   - Clean section header: "ACTIVE SESSIONS" with active session count badge.
   - Enhanced typography: 13px (`text-[13px]`), `font-semibold`.
   - Enhanced border structure: bolder lines with subtle provider-tinted borders.
   - Provider-colored title text: each active tab displays its title tinted with its provider brand color.
3. **Current Active Tab Styling (Arc-Reactor Cockpit Pill):**
   - Matching the visual elegance of `TitlebarModelPillar`:
     - Dynamic CSS gradient border (`--provider-gradient-start`, `--provider-gradient-end`).
     - Spatial cockpit background with rich dark glass gradient.
     - Ambient glow box-shadow with high-luminance accent.
     - Pulsing active core dot (`.active-core-dot`) with animated radar ripple.
4. **Clean Divider & Sleeping / Discarded Section:**
   - Subtle separator divider with icon and "SLEEPING / DISCARDED" header with count badge.
   - Hibernated tabs rendered with subdued opacity (75%), softer borders, and sleeping moon/zZz indicator.
   - Clicking any sleeping tab immediately wakes and restores it, transitioning it to the Active Sessions section.
   - Retain full drag-to-reorder, context-menu pinning, and close button actions across both sections.
5. **Collapsed Sidebar Compatibility:**
   - Cleanly adapt both sections when sidebar is collapsed, preserving the 3-5 word chips, status indicators, and active arc-reactor glow.

## 3. Implementation Steps
1. **Expose Resident Tab IDs in Discard System:**
   - Add `residentTabIds?: string[]` and `discardedTabIds?: string[]` to `TabDiscardStatus` in `src/shared/tabDiscardPolicy.ts` and `src/main/tabDiscardManager.ts`.
   - Expose `getResidentTabIds()` and `getDiscardedTabIds()` in `tabDiscardManager`.
   - Emit `tab_discard_status_updated` event to the renderer on eviction and view creation.
2. **Update `src/renderer/src/App.tsx` and `App_gemini.tsx`:**
   - State: `residentTabIds`.
   - Pass `residentTabIds={residentTabIds}` to `VerticalTabs`.
3. **Update `src/renderer/src/components/VerticalTabs.tsx` and `VerticalTabs.css`:**
   - Implement partitioning logic into `activeTabs` and `discardedTabs`.
   - Implement "Active Sessions" header, 13px font-semibold, colored titles.
   - Implement Arc-Reactor Cockpit styling for the active tab (gradient border, glow, `.active-core-dot` with radar ripple).
   - Implement "Sleeping / Discarded" divider and hibernated tabs section.
4. **Update Tests in `src/renderer/src/components/VerticalTabs.test.tsx` and `_gemini.test.tsx`:**
   - Test partitioning into Active and Discarded sections.
   - Test Arc-Reactor styling and active dot presence.
   - Test waking sleeping tab on click.
5. **Synchronize All `_gemini` Files and Verify Suite:**
   - Run `npx vitest run src/renderer/src/components/VerticalTabs.test.tsx`.
   - Run `npm test`, `npm run typecheck`, and `npm run build`.
