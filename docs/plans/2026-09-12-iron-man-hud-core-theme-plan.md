# Iron Man HUD Core Theme & Design System Plan

## Objective
Establish the core Iron Man J.A.R.V.I.S. HUD aesthetic and token system derived directly from `/home/elsadek/.config/hypr/iron_man/quickshell`.

## Visual Tokens & Palette
Extracted from `GlobalTheme.qml`, `GlobalConfig.qml`, and `TacticalShard.qml`:
- **Void Background**: `#050F14` / `#070F1C` (Deep holographic black/navy)
- **Core Glow**: `#00E5FF` / `#00FFFF` (Electric Arc Reactor Cyan)
- **Arc Sky Blue**: `#00BFFF` (Secondary tactical glow)
- **Cobalt Data**: `#0D47A1` (Telemetry lines and inactive borders)
- **Muted Sensor**: `#0369A1` (Subtle brackets and dividers)
- **Stark Amber/Gold**: `#FFB700` / `#FFD700` (Warnings, energy readouts, special badges)
- **Tactical Red**: `#FF0000` / `#FF4081` (Critical alert states and destructive actions)
- **Typography**: `Share Tech Mono`, `Rajdhani`, `CaskaydiaCove NF`, monospace uppercase with letter-spacing.
- **Background Pattern**: Exact SVG Hex Grid (`hex_grid.svg`) with cyan wireframe opacity (`rgba(0, 229, 255, 0.07)`).

## Architectural Strategy
1. **AppTheme Integration**:
   - Add a first-class preset theme `iron-man-hud` in `src/renderer/src/lib/themes.ts` with these exact colors and 4px/0px sharp corner curvature.
   - Add `'iron-man-hud'` to `AestheticPreset` in `src/renderer/src/lib/interfaceSettings.ts` configured as the premier flagship experience.
2. **CSS HUD Utilities & Primitives (`App.css`)**:
   - `.hud-bracket-box`: Pseudo-elements `::before` and `::after` generating tactical corner reticles (`⌜ ⌝ ⌞ ⌟`).
   - `.hud-chamfer`: 45° angled clip-path polygon cuts (`clip-path: polygon(12px 0, 100% 0, 100% calc(100% - 12px), calc(100% - 12px) 100%, 0 100%, 0 12px)`).
   - `.hud-scanline`: Animated CRT/holographic horizontal scanline sweep.
   - `.hud-grid-bg`: Embedded SVG hex-grid pattern matching quickshell's `hex_grid.svg`.
   - `.hud-glow-cyan`, `.hud-glow-amber`, `.hud-glow-red`: Multi-layer drop-shadow and box-shadow filters.
