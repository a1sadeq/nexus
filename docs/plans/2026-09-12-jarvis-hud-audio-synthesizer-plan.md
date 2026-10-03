# J.A.R.V.I.S. HUD Audio Synthesizer Plan

## Objective
Implement a zero-dependency, ultra-low-latency Web Audio API sound synthesizer producing tactile J.A.R.V.I.S. telemetry and UI sound effects without any external `.wav` or `.mp3` files.

## Audio Sound Palette (Synthesized Oscillators)
1. **Boot Chime (`playBootSequence`)**: Ascending harmonic chord (sine/triangle waves ramping 220Hz -> 440Hz -> 880Hz -> 1760Hz with low-pass resonance).
2. **Tactical Click (`playClick`)**: Ultra-short 15ms frequency drop chirp (1200Hz -> 300Hz) on button activations.
3. **Hover Reticle Lock (`playHover`)**: Soft 10ms high-pitch frequency blip (2400Hz at low gain) when hovering HUD interactive controls.
4. **Target Acquisition / Modal Open (`playModalOpen`)**: Sweeping dual-tone laser telemetry pulse (400Hz -> 1400Hz with exponential decay).
5. **System Alert / Critical (`playAlert`)**: Dual square wave buzz (440Hz & 880Hz pulse).
6. **Upload Complete / Success (`playSuccess`)**: Crisp dual high-frequency harmonic chime (880Hz + 1320Hz).

## Implementation Details
- Create `src/renderer/src/lib/hudAudio.ts` with lazy `AudioContext` initialization on first user interaction.
- Global Mute State persisted in `localStorage` under `nexus.hud.sound_muted` (defaults to unmuted).
- Export clean helper hooks/functions: `hudAudio.click()`, `hudAudio.hover()`, `hudAudio.modalOpen()`, `hudAudio.boot()`, `hudAudio.toggleMute()`, `hudAudio.isMuted()`.
