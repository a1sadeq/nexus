# Task 6: Titlebar Pillar Styling & Spatial Arc-Reactor Animations

## Objective
Implement the UI/UX Pro Max Spatial Cockpit Arc-Reactor design on `TitlebarModelPillar` with adaptive ambient aura, brand-colored inactive pills, multi-layer gradient active pills, and a pulsing micro-radar core dot.

## Design Specifications (UI/UX Pro Max Guidance)
1. **Pillar Dock Container (Adaptive Ambient Aura)**:
   - Outer border and inner reflection dynamically tint to the active provider's primary color:
     `border-color: color-mix(in srgb, var(--active-provider-color, #00e5ff) 24%, rgba(255, 255, 255, 0.08))`
     `box-shadow: 0 4px 24px rgba(0, 0, 0, 0.65), inset 0 1px 0 rgba(255, 255, 255, 0.12), inset 0 0 16px color-mix(in srgb, var(--active-provider-color, #00e5ff) 10%, transparent)`
   - Dark obsidian frosted glass (`rgba(8, 12, 22, 0.88)` with `backdrop-filter: blur(20px)`).

2. **Inactive Provider Pills (Subtle Brand Identity)**:
   - Display each provider's distinct brand-colored icon (`color: var(--provider-color)`).
   - Subtle 1px translucent border tinted with the provider's color (`border-color: color-mix(in srgb, var(--provider-color) 18%, transparent)`).
   - Micro-translucent background (`background: color-mix(in srgb, var(--provider-color) 5%, transparent)`).
   - Hover state: Smooth scale `1.03`, border brightens to 45%, background to 14%, and icon gets an ambient glow (`drop-shadow(0 0 6px var(--provider-color))`).

3. **Active Provider Pill (Spatial Arc-Reactor)**:
   - Rich signature dual-tone gradient fill:
     `background: linear-gradient(135deg, color-mix(in srgb, var(--provider-gradient-start) 32%, rgba(12, 18, 32, 0.95)), color-mix(in srgb, var(--provider-gradient-end) 24%, rgba(8, 12, 20, 0.98)))`
   - High-luminance top specular highlight (`inset 0 1px 0 rgba(255, 255, 255, 0.35)`).
   - Layered glowing aura:
     `box-shadow: 0 0 16px color-mix(in srgb, var(--provider-color) 45%, transparent), 0 0 32px color-mix(in srgb, var(--provider-color) 20%, transparent)`
   - Smooth 2.6s breathing animation (`arcReactorBreathe`) operating strictly on compositor properties (`opacity`, `transform: scale()`).

4. **Micro-Reactor Core Dot (Radar Ripple Shockwave)**:
   - Core dot: Concentric luminous point with multi-tier box-shadow.
   - Ripple effect (`::after` pseudo-element): An expanding translucent ring emitting from the dot every 2.6s (`@keyframes radarRipple`: scale 1 to 2.8, opacity 0.8 to 0).

5. **Fluid Morphing Transition**:
   - Fast spring crossfade (200ms `cubic-bezier(0.16, 1, 0.3, 1)`) on color, background, and shadows when switching providers.

6. **Accessibility & Responsiveness**:
   - WAI-ARIA roving tabindex and arrow keys preserved.
   - Responsive tiers (Expanded labels at $\ge 1440$px, icon badges at 1100-1439px, compact HUD at $<1100$px).
   - `@media (prefers-reduced-motion: reduce)` disables radar ripples and breathing pulsation.
