# Remove MARK-HUD Badge Plan

## Objective
Remove the `MARK-HUD` telemetry badge text from the top navbar status header, leaving the mini pulsing Arc Reactor diagnostic button clean and uncluttered.

## Problem Analysis
- In `src/renderer/src/components/HudStatusHeader.tsx`, the `MARK-HUD` badge was rendered alongside the mini Arc Reactor diagnostics trigger.
- The user requested to remove `mark hud` from the tab bar.

## Tasks
1. **Remove Badge from HudStatusHeader.tsx**:
   - In `src/renderer/src/components/HudStatusHeader.tsx`, remove the `MARK-HUD` text container and its pulsing cyan dot.
   - Retain the Arc Reactor button with its diagnostic click trigger (`onTriggerBoot`).
2. **Verification**:
   - Verify top navbar displays the clean Arc Reactor diagnostic button without the `MARK-HUD` text.
