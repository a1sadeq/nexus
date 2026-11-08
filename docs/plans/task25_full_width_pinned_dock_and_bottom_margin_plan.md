# Task 25 Plan: Full-Width Bottom Pinned Dock & Webview Bottom Margin

## 1. Context and Problem Statement
1. **Pinned Dock Width Restriction:**
   - Currently, `{/* BOTTOM PINNED CHATS DOCK */}` is nested inside `{/* 2. MAIN WORKING AREA */}` in `src/renderer/src/App.tsx`.
   - When the vertical tabs sidebar is visible, the dock only spans the main working area's width instead of spanning the entire window width undercutting the sidebar.
2. **AI Webview Prompt Input Bar Clipping:**
   - The native `WebContentsView` touches the bottom border of the content area.
   - Provider input composers (e.g., ChatGPT, Claude, Gemini, z.ai, LM Arena) and toolbars are right against the dock edge or partially clipped, making bottom action elements difficult to view or click.

## 2. Requirements & Desired Behavior
1. **Full-Width Bottom Pinned Dock:**
   - Move the bottom dock outside `{/* 2. MAIN WORKING AREA */}` so it sits at the bottom of the root viewport container.
   - Apply `w-full` across the full window width, cleanly undercutting the vertical sidebar.
2. **Webview Bottom Clearance:**
   - Provide a 24px bottom buffer on the webview container so provider prompt input boxes, action pills, and status bars are comfortably visible above the bottom dock.
   - Use `absolute inset-x-0 top-0 bottom-6` on the `containerRef` element so that its DOM bounding box naturally has 24px bottom clearance.
   - Ensure `containerBounds()`, `restoreViewBounds()`, and `ResizeObserver` all compute and send accurate bounds to the native `WebContentsView` in Electron.

## 3. Implementation Steps
1. **Modify `src/renderer/src/App.tsx` and `App_gemini.tsx`:**
   - Relocate the bottom dock JSX block from inside `MAIN WORKING AREA` to be a child of the outer root container (right after the middle flex body).
   - Update container div with `className="absolute inset-x-0 top-0 bottom-6" ref={containerRef}`.
   - Update `containerBounds()` to return the measured bounds of `containerRef`.
   - Ensure `restoreViewBounds()` uses `containerBounds()`.
2. **Synchronize `_gemini` Files:**
   - Keep `src/renderer/src/App.tsx` and `src/renderer/src/App_gemini.tsx` synchronized.
3. **Verification:**
   - Typecheck and build verification (`npm run typecheck`, `npm run build`).
