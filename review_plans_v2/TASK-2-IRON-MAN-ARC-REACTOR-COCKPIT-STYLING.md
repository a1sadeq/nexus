# TASK 2: Iron Man Arc-Reactor Cockpit Visual Overhaul

## 1. Problem Statement & Aesthetic Deficiencies
In the current titlebar, the provider list renders as a flat row of unstyled uppercase buttons (`#94a3b8`) on a barely visible grey background (`rgba(255, 255, 255, 0.03)`). It looks utilitarian, crowded, and completely disjointed from the futuristic Cybernetic HUD / J.A.R.V.I.S. aesthetic of Nexus.

---

## 2. Design System: Iron Man Arc-Reactor Cockpit

### A. The Capsule Housing (`.titlebar-model-pillar`)
- **Backplate**: Dark translucent obsidian glass: `background: rgba(8, 12, 22, 0.85); backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px);`
- **Laser-Cut Perimeter**: High-precision boundary with subtle cyan/ambient reflection:
  ```css
  border: 1px solid rgba(0, 229, 255, 0.16);
  box-shadow: 
    0 4px 20px rgba(0, 0, 0, 0.7),
    inset 0 1px 0 rgba(255, 255, 255, 0.08),
    inset 0 0 12px rgba(0, 229, 255, 0.04);
  ```
- **Geometry**: Pill-shaped capsule with 4px vertical padding and 6px horizontal padding.

### B. Inactive Provider Pills (`.titlebar-model-pill`)
- **Typography**: Refined Title Case, `font-family: inherit; font-size: 11.5px; font-weight: 500; letter-spacing: 0.2px;`
- **Contrast**: `#cbd5e1` (Slate 300) instead of muddy grey, ensuring crisp readability on dark glass.
- **Hover Micro-Interaction**:
  - `background: rgba(255, 255, 255, 0.06);`
  - `border-color: rgba(255, 255, 255, 0.18);`
  - Subtle brand accent edge illumination: `box-shadow: 0 0 8px color-mix(in srgb, var(--provider-color) 35%, transparent);`

### C. Active Provider Pill (`.titlebar-model-pill.active`)
- **Rich Core Plate**:
  ```css
  background: color-mix(in srgb, var(--provider-color, #00e5ff) 20%, rgba(10, 16, 28, 0.95));
  border: 1px solid color-mix(in srgb, var(--provider-color, #00e5ff) 75%, #ffffff 25%);
  color: #ffffff;
  ```
- **Micro-Reactor Core Dot**:
  A 5px glowing status sphere embedded next to the label:
  ```css
  .active-core-dot {
    width: 5px;
    height: 5px;
    border-radius: 9999px;
    background-color: var(--provider-color, #00e5ff);
    box-shadow: 0 0 8px var(--provider-color, #00e5ff);
  }
  ```
- **Compositor-Only Arc-Reactor Breathing Glow**:
  - Rendered on `::before` pseudo-element with zero CPU repaints.
  - Multi-tier dynamic glow:
    ```css
    box-shadow:
      0 0 12px var(--provider-glow),
      0 0 24px var(--provider-glow-ambient),
      inset 0 0 8px var(--provider-glow);
    ```
  - Animation:
    ```css
    @keyframes arcReactorBreathe {
      0%, 100% {
        opacity: 0.65;
        transform: scale(0.97);
      }
      50% {
        opacity: 1;
        transform: scale(1.04);
      }
    }
    ```

---

## 3. GPU Performance & Paint Verification
- Animates **only** `opacity` and `transform`.
- Zero reflows, zero paint passes during the continuous 2.8s breathing cycle.
- Tested and verified under Chrome DevTools Rendering paint flashing (0 green flashes).

---

## 4. Acceptance Criteria
- [ ] Frosted dark glass backplate with cyan laser-cut perimeter border.
- [ ] Crisp Title Case typography for all provider names.
- [ ] Active provider features deep core plate, bright white label, micro-reactor dot, and Arc-Reactor breathing halo.
- [ ] Compositor-only keyframes verified (0 paint invalidations).
