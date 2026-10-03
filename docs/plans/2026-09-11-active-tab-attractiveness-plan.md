# Active Tab Attractiveness Plan

## Objective
Make the active tab stand out visually beyond a simple background highlight.

## Current Situation
`App.css` actually contains advanced CSS rules for beautiful active tab states (e.g., `.chat-tab-pill[data-active='true']` with rules for `gradient-pill`, `cyberpunk-neon`, etc.). However, in `ChatTabs.tsx`, the `data-active` attribute is completely missing from the `.chat-tab-pill` element! Because of this, the active tab falls back to the hardcoded Tailwind utility classes (`bg-(--border) border-(--accent)`), which are boring.

## Proposed Implementation
- Add `data-active={isActive}` to the `.chat-tab-pill` `<div>` in `ChatTabs.tsx`.
- Refine the default fallback Tailwind classes to be a bit nicer just in case the user has no advanced theme selected (e.g., `bg-(--surface2)` or a subtle glow).
