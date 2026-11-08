# Task 29 Plan: Webview Container Flush Dock Layout

## Context & Objectives
- In Task 25, a 24px bottom buffer (`bottom-6`) was added to `containerRef` inside `App.tsx` (`<div className="absolute inset-x-0 top-0 bottom-6" ref={containerRef} />`).
- This created an unintentional 24px black void/gap between the bottom of the AI `WebContentsView` and the top border of the horizontal pinned tabs dock (`h-14`).
- Objective: Eliminate the 24px bottom gap so the AI webview sits flush against the top border of the pinned tabs dock (`bottom-0` / `absolute inset-0`).

## Execution Steps
1. In `src/renderer/src/App.tsx`:
   - Change `<div className="absolute inset-x-0 top-0 bottom-6" ref={containerRef} />` to `<div className="absolute inset-0" ref={containerRef} />`.
2. Mirror all changes to `src/renderer/src/App_gemini.tsx`.
3. Verify layout dimensions and resize handling.
