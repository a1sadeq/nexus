# Pinned Tabs Resize Plan

## Objective
Increase the size of the pinned tabs in the `PinnedSidebar.tsx` component for both collapsed and expanded states to improve visibility and clickability.

## Implementation Details
1. **Collapsed State Adjustments:**
   - Increase the clickable button dimensions (e.g., from `w-9 h-9` to `w-12 h-12`).
   - Increase the inner circular icon container (e.g., from `w-7 h-7` to `w-9 h-9`).
   - Increase the `BrandIcon` size (e.g., from `16` to `20`).

2. **Expanded State Adjustments:**
   - Increase the inner circular icon container (e.g., from `w-8 h-8` to `w-10 h-10`).
   - Increase the `BrandIcon` size (e.g., from `18` to `22`).
   - Optionally scale up the title font size from `text-sm` to `text-base` if the user desires larger text.
