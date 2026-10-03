# Plan: Modern Tab Hover Expansion & Colorful Animation

## Status: Ready for implementation

## Objective
When a user hovers over a tab in the top bar, it should wait 300ms, then expand as a floating overlay to reveal the full title (up to 400px max width). The expanded state will feature an animated gradient border (glowing edge).

## User Requirements Gathered
1. **Layout:** Floating overlay/tooltip over adjacent tabs to prevent layout shift.
2. **Animation Style:** Animated gradient border sweeping around the tab.
3. **Delay:** 300ms delay before expansion.
4. **Max Constraints:** Max width around 400px, truncating gently if it exceeds this.

## Implementation Steps
1. **Component Updates (`ChatTabs.tsx`):**
   - Add local state for `hoveredTabId`.
   - Add a `setTimeout` (300ms) on `onMouseEnter`, cleared on `onMouseLeave`.
   - When a tab is the `hoveredTabId`, render an absolutely positioned overlay *exactly* over the tab, but allowed to break out of the tab's width constraint (`z-index` higher than other tabs).
2. **CSS/Tailwind (`App.css` or inline):**
   - Create a `@keyframes` for the sweeping gradient border.
   - Use a `conic-gradient` mask or a pseudo-element (`::before`) with a rotating gradient to create the glowing edge effect on the expanded overlay.
   - Apply smooth `transition-all duration-300` for the width/opacity expansion.
3. **Refinement:**
   - Ensure the close button (`IconX`) remains accessible and clickable inside the expanded overlay.
   - Ensure it looks good for both pinned and unpinned tabs.
