# TASK 3: Dynamic Responsive Dock & Tooltip System

## 1. Problem Statement
When a user has 8 to 10+ providers configured (as seen in the user's screenshot with 10 providers), rendering full text labels + icons for every single item requires >820px width. In smaller windows (<1350px), this crowds out the conversation title on the left and risks overlapping with window controls on the right.

---

## 2. Dynamic Responsive Dock Architecture

Instead of static breakpoints that clumsily hide or shrink everything at once, the **Dynamic Responsive Dock** applies a tiered layout:

### A. Tiers & Layout Logic:
1. **Tier 1: Expanded Cockpit (Window Width ≥ 1400px)**:
   - Active provider: **Icon + Full Label + Micro-Reactor Dot**.
   - Inactive providers: **Icon + Label**.
   - Spacious 6px gap between pills.

2. **Tier 2: Focus Dock (Window Width 1100px – 1399px)**:
   - Active provider: **Icon + Full Label + Micro-Reactor Dot** (stays prominent and clear).
   - Inactive providers: **Icon-only** circular/oval capsules (30px diameter) with smooth hover expand on focus/hover.
   - Saves ~350px of horizontal titlebar width while keeping all 10 providers one click away!

3. **Tier 3: Compact Tactical HUD (Window Width < 1100px)**:
   - All providers collapse to compact icon badges (26px diameter).
   - Active provider highlighted with vivid Arc-Reactor breathing ring and glowing brand color.
   - Guarantees 100% clearance from window caption controls (reserve 140px on Windows) and the left conversation pill.

---

## 3. Tooltip System (`TitlebarTooltip`)
For icon-only pills in Tier 2 and Tier 3:
- Hovering or keyboard-focusing any pill immediately displays a high-contrast HUD tooltip:
  - Example: `GLM (Z.ai) — Active Provider` or `DeepSeek — Switch (Alt+4)`.
  - Dark glass styling with neon accent border matching `--provider-color`.
  - Non-blocking, GPU-accelerated fade-in (100ms delay to prevent visual flicker).

---

## 4. Keyboard Navigation & WAI-ARIA
- Roving `tabindex`: Active provider has `tabIndex={0}`, all others have `tabIndex={-1}`.
- Arrow keys (`ArrowLeft`, `ArrowRight`, `ArrowUp`, `ArrowDown`, `Home`, `End`) cycle smoothly between providers.
- Pressing `Enter` or `Space` activates/deploys the focused provider.

---

## 5. Acceptance Criteria
- [ ] At ≥1400px: Full labels and icons displayed.
- [ ] At 1100px–1399px: Active provider retains label; inactive providers collapse cleanly to icon badges.
- [ ] At <1100px: Compact tactical HUD with zero layout overflow or control clipping.
- [ ] Tooltip appears cleanly on hover and keyboard focus for all icon badges.
- [ ] WAI-ARIA `role="radiogroup"` with roving tabindex functions 100% across all tiers.
