# Plan: Default Config for New Users

**Date:** 2026-11-02
**Status:** Complete

## Goal

New installs should start with the layout and provider set the owner actually
uses, so the first launch already looks like a power-user setup.

## Changes

### 1. Pinned dock at the bottom

File: `src/renderer/src/lib/interfaceSettings.ts`

- `DEFAULT_INTERFACE_SETTINGS.pinnedPosition`: `'sidebar'` → `'bottom'`.

Effect: pinned chats render in the bottom dock (`App.tsx` already supports
`pinnedPosition === 'bottom'`). Existing users keep their saved value because
settings are merged over defaults from localStorage.

### 2. Eight default providers

File: `src/renderer/src/App.tsx`

Replace the four hardcoded `DEFAULT_MODELS` with the owner's live
`models.json` order (the running profile, not the stale snapshot):

1. Gemini — `https://gemini.google.com`
2. Qwen — `https://chat.qwen.ai`
3. Kimi — `https://kimi.ai`
4. DeepSeek — `https://chat.deepseek.com`
5. Perplexity — `https://www.perplexity.ai`
6. gemini_aistudio — `https://aistudio.google.com/prompts/new_chat`
7. arena-ai — `https://arena.ai/`
8. z-glm — `https://chat.z.ai/`

Keep each provider's icon, color, and description exactly as configured.

## Non-goals

- Do not overwrite existing users' `vicinae.models` or interface settings.
- Do not change provider theme overrides in `providers.json`; those are
  per-user runtime config, not shipped defaults.

## Verification

- Delete/rename local `vicinae.models` + interface settings in a throwaway
  profile, launch, confirm 8 providers and bottom dock.
- `npm run typecheck` and `npm test`.
- Existing profile still opens with its saved layout.

## Risks

- Bottom dock uses vertical space; verify on a 1366x768 viewport.
- Provider URLs change often; `models.json` remains the user-editable source.
