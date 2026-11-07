# Task 5: Dynamic AI Provider Color & Dual-Tone Gradient System

## Objective
Establish a unified color & gradient engine that provides hand-crafted signature brand palettes for all built-in AI providers while seamlessly supporting user-customized colors from Settings (`models.json`).

## Requirements
1. **Authentic Signature Palettes**:
   - Provide distinct primary and secondary gradient tones for every major provider:
     - **Gemini**: Electric Cyan (`#22d3ee`) $\rightarrow$ Ultraviolet Indigo (`#4f46e5`)
     - **ChatGPT**: OpenAI Emerald (`#10a37f`) $\rightarrow$ Mint Teal (`#059669`)
     - **Claude**: Anthropic Terracotta (`#d97757`) $\rightarrow$ Warm Coral/Amber (`#ea580c`)
     - **DeepSeek**: Cobalt Blue (`#4d6bfe`) $\rightarrow$ Electric Cyan (`#06b6d4`)
     - **Qwen**: Royal Purple (`#615ced`) $\rightarrow$ Neon Violet (`#8b5cf6`)
     - **Kimi**: Moonlight Violet (`#8b5cf6`) $\rightarrow$ Magenta Iris (`#c084fc`)
     - **Perplexity**: Cyan Teal (`#22b8cd`) $\rightarrow$ Ocean Azure (`#0284c7`)
     - **Arena / LMSYS**: Warm Amber (`#f59e0b`) $\rightarrow$ Flame Orange (`#f97316`)
     - **GLM / Z.ai**: Electric Sapphire (`#1055ff`) $\rightarrow$ Tech Blue (`#3b82f6`)
     - **Albert**: Deep Amethyst (`#a855f7`) $\rightarrow$ Neon Orchid (`#d946ef`)
     - **Mistral**: Vibrant Tangerine (`#f97316`) $\rightarrow$ Sunset Gold (`#f59e0b`)
     - **Grok**: Platinum Silver (`#f1f5f9`) $\rightarrow$ Slate Chrome (`#94a3b8`)
2. **User Custom Color Derivation**:
   - If the user modifies a provider's color in Settings (`m.color`), automatically compute the secondary gradient color, ambient glow, and border highlight using CSS `color-mix()` / color manipulation, preserving user customization while maintaining aesthetic harmony.
3. **Data Integrity & Consistency**:
   - Expose helpers in `src/renderer/src/lib/modelVisuals.ts`:
     - `getProviderGradient(modelKey: string, customColor?: string): { start: string; end: string }`
     - `getProviderColor(modelKey: string, customColor?: string): string`
4. **Verification**:
   - Add unit tests in `src/renderer/src/lib/modelVisuals.test.ts`.
