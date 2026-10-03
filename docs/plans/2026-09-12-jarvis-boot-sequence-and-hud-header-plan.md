# J.A.R.V.I.S. Boot Sequence & Tactical HUD Header Plan

## Objective
Provide an authentic Stark Industries boot calibration animation and an interactive HUD Telemetry status bar in the top navigation header.

## Components & Visuals
1. **Boot Sequence Component (`src/renderer/src/components/JarvisBootOverlay.tsx`)**:
   - Fires on application launch (or when triggered manually from the HUD badge).
   - Rotating dual concentric SVG rings inspired by `ring_outer.svg` and `ArcReactor.qml`.
   - Dynamic telemetry calibration readouts:
     - `STARK INDUSTRIES OS // MARK-HUD v4.2`
     - `SYSTEM DIAGNOSTICS: NOMINAL`
     - `NEURAL INTERFACES: CONNECTED`
     - `CALIBRATING ARC REACTOR FLUX... 100%`
   - Plays the synthesized J.A.R.V.I.S. boot chime via `hudAudio.boot()`.
   - Auto-dismisses smoothly after ~1.4 seconds with a circular iris-wipe or fade-out.
2. **Tactical HUD Header Module (`src/renderer/src/components/HudStatusHeader.tsx`)**:
   - Positioned in `top-navbar` between the tab strip and right-side controls.
   - **Arc Reactor Mini Badge**: Live pulsing cyan reactor core icon. Clicking it re-triggers the diagnostics sweep.
   - **Sound Control**: Speaker / Waveform icon displaying MUTE / UNMUTE with instant toggle and sound cue.
   - **Protocol Indicator**: `MARK-HUD // ONLINE` badge with status LED.
