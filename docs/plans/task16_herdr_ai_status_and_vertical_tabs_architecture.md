# Task 16: Herdr AI Status & Vertical Tabs Architecture

## 1. Context & Objective
The user requested modern vertical browser tabs modeled after modern browser styles (Arc, Edge, Zen) combined with Herdr's (`https://herdr.dev/`) agent-state awareness.
When multiple AI agents or conversations run concurrently across tabs:
- The user cannot tell which tab is generating, which tab finished, or which tab is blocked waiting for user input/choice.
- Traditional browser tabs treat every webpage as a passive static document; AI browser tabs are living asynchronous agents.

## 2. Herdr AI Session Status State Machine
Each tab tracks an AI state:
```ts
export type TabAiStatus = 'idle' | 'working' | 'waiting-input' | 'done' | 'error';
```

### State Transitions:
1. **`idle`**: The tab is stationary with no active generation or pending prompts.
2. **`working`**:
   - Triggered when `ai-loading` is true or user submits a prompt.
   - Visual: Orbital spin / pulse indicator with provider accent or cyan glow.
3. **`waiting-input`**:
   - Triggered when a background tab finishes generating (`working` -> `waiting-input`), signaling the AI has responded and is awaiting the user's next prompt or interactive choice.
   - Also flagged if webview title/event matches questions/confirmations.
   - Visual: Pulsing amber/gold beacon (`#f59e0b` / `var(--accent)`) with gentle attention animation (`scale-105` ring pulse).
4. **`done`**:
   - Tab has finished execution and has been viewed/acknowledged by the user.
   - Visual: Crisp emerald/accent dot (`#10b981`), calming down after 5 seconds to `idle`.
5. **Clear on Focus**:
   - When the user switches to an active tab (`activeId === tab.id`), any pending `waiting-input` badge is automatically acknowledged/cleared to prevent notification fatigue.

## 3. UI/UX Pro Max Design Principles
Applying `ui-ux-pro-max` guidelines:
- **Rule §1 (Accessibility)**: Status indicators must include `aria-label` and `role="status"` with semantic announcements.
- **Rule §2 (Touch & Interaction)**: Minimum clickable touch targets (44×36px per vertical tab item).
- **Rule §6 (Typography & Color)**: High contrast against dark surfaces (`bg-(--surface)` / `bg-(--bg)`), semantic tokens.
- **Rule §7 (Animation)**: Gentle micro-animations (150-250ms cubic-bezier), `prefers-reduced-motion` compliance.

## 4. Deliverables
1. Types in `src/renderer/src/lib/tabs.ts` and `src/renderer/src/lib/tabStatus.ts`.
2. State tracking hooks in `App.tsx` responding to `ai-loading`, navigation, and tab switching.
3. Status badge component with Herdr animations in `src/renderer/src/components/AiStatusBadge.tsx`.
