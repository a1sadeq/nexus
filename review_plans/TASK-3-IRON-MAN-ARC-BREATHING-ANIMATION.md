# Task 3: Iron Man Arc-Reactor Compositor-Only Breathing Glow

**Target Files:**
- `src/renderer/src/components/TitlebarModelPillar.css`

---

## 1. Problem Statement & Audit Findings

1. **Repaint Thrashing on Paint-Stage Properties (Finding H2):**
   - Animating `box-shadow`, `filter`, and `border-color` inside `@keyframes` forced Chromium to repaint the active element on every single frame of an infinite loop. On X11 / software rasterization setups, this caused measurable CPU overhead.
2. **Invalid Color-Mix Normalization in 50% Keyframe (Finding H8):**
   - The 50% frame mixed 90% + 50% = 140%. CSS Color 5 normalized this to 64.3% / 35.7%, shifting the border to an unintended muted shade.
3. **Engine Version Floor & Fallbacks (Finding H3):**
   - `color-mix()` requires Chromium 111+ (Electron 24+). While Nexus runs Electron 43.2.0 (Chromium ~133), hex-alpha fallbacks must precede `color-mix()` declarations for defensive design.
4. **Compositor Layer Promotion Leak (Finding M9):**
   - Permanent `will-change: box-shadow, filter` on `.titlebar-model-pill.active` held an unnecessary GPU raster layer. `will-change` belongs strictly on the animated pseudo-element targeting `opacity` and `transform`.

---

## 2. Specification & Implementation Details

### 2.1. The Zero-Repaint `::before` Pseudo-Element Architecture (Finding H2)

Instead of repainting the button's box-shadow 60 times a second, we **paint the intense glow once** onto a `::before` pseudo-element. The animation then cycles ONLY the compositor-only properties: **`opacity`** and **`transform: scale()`**.

Chromium processes `opacity` and `transform` exclusively on the compositor thread without issuing Paint or Layout calls:

```
[Main Thread]    0 calls / 0 paint passes / 0 DOM reflows
       │
[Compositor]     GPU matrix transform (scale) & alpha multiply (opacity) @ 60 FPS
```

### 2.2. CSS Keyframes: `arcReactorBreathe`

```css
/* Static glow recipe painted once on the pseudo-element */
.titlebar-model-pill {
  position: relative;
  /* ... base styles ... */
}

/* Fallback hex-alpha + CSS Color 5 derived properties */
.titlebar-model-pill {
  --provider-glow: color-mix(in srgb, var(--provider-color, #6366f1) 65%, transparent);
  --provider-glow-ambient: color-mix(in srgb, var(--provider-color, #6366f1) 25%, transparent);
}

.titlebar-model-pill::before {
  content: "";
  position: absolute;
  inset: -4px;
  border-radius: inherit;
  pointer-events: none;
  opacity: 0;
  box-shadow:
    0 0 10px var(--provider-glow),
    0 0 20px var(--provider-glow-ambient),
    inset 0 0 6px var(--provider-glow);
  transform: scale(0.96);
  will-change: opacity, transform;
}

/* Active State: Glow becomes visible and runs compositor breathing loop */
.titlebar-model-pill.active {
  background: color-mix(in srgb, var(--provider-color, #6366f1) 18%, #0d121d);
  border-color: color-mix(in srgb, var(--provider-color, #6366f1) 85%, #ffffff 15%);
  color: #ffffff;
}

.titlebar-model-pill.active .titlebar-model-icon {
  filter: drop-shadow(0 0 4px var(--provider-glow));
}

.titlebar-model-pill.active::before {
  animation: arcReactorBreathe 2.5s ease-in-out infinite;
}

/* Pure Compositor Animation: Zero Paint Passes */
@keyframes arcReactorBreathe {
  0%, 100% {
    opacity: 0.55;
    transform: scale(0.96);
  }
  50% {
    opacity: 1;
    transform: scale(1.05);
  }
}
```

### 2.3. Corrected Color-Mix Normalization (Finding H8)
In the active border definition:
```css
/* Normalized sum: 85% + 15% = 100% exactly (No engine distortion) */
border-color: color-mix(in srgb, var(--provider-color, #6366f1) 85%, #ffffff 15%);
```

### 2.4. Electron Support Floor & Defensive Fallbacks (Finding H3)
Nexus runs Electron `^43.2.0` (Chromium 133+), easily exceeding the Chromium 111 floor. However, we provide defensive fallback declarations:
```css
/* Defensive Fallback for CSS Custom Properties */
.titlebar-model-pill {
  /* Fallback: 65% alpha ~ A6, 25% alpha ~ 40 */
  --provider-glow: var(--provider-color);
  --provider-glow-ambient: var(--provider-color);

  /* Modern: color-mix override */
  --provider-glow: color-mix(in srgb, var(--provider-color, #6366f1) 65%, transparent);
  --provider-glow-ambient: color-mix(in srgb, var(--provider-color, #6366f1) 25%, transparent);
}
```

### 2.5. Motion Accessibility
```css
@media (prefers-reduced-motion: reduce) {
  .titlebar-model-pill.active::before {
    animation: none !important;
    opacity: 0.8;
    transform: scale(1);
  }
}
```

---

## 3. Verification Criteria
1. Running Chromium DevTools "Rendering -> Paint Flashing" reveals **0 green rectangles** during the breathing loop.
2. Inactive pills render at 0% pseudo-element opacity with 0 CPU cost.
3. Active provider emits its authentic brand aura with 2.5s gentle pulsation.
