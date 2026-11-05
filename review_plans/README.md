# Nexus Feature Review Package: AI Models Titlebar Pillar & Iron Man HUD (v2 — Post-Audit)

**Package Path:** `/home/elsadek/vicinae/nexus electron/review_plans`  
**Feature Branch:** `main` (Nexus Electron Workspace)  
**Status:** Post-Audit Revision (All 29 Findings & 5 Blockers Resolved)  
**Date:** 2026-11-05  

---

## Executive Summary & Audit Resolution

Following the expert review in `Nexus_Titlebar_Pillar_Expert_Review.md`, all 29 audit findings across TASK-1 to TASK-5 have been incorporated. Specifically, the **5 Critical Blockers** and **8 High-Severity Gaps** have been resolved:

1. **B1 Resolved (Zero-Interception Hover Trigger):** Removed the full-width 4px transparent overlay div that swallowed clicks on the tab strip. Replaced with an active `window` mousemove boundary listener (`clientY <= 4`) that consumes 0 clicks.
2. **B2 Resolved (150ms Dwell Before Reveal):** Added an intentional 150ms hover dwell timer before sliding down the floating titlebar, preventing accidental provider clicks when moving the mouse to the tab strip.
3. **B3 Resolved (3-Tier Responsive Titlebar Budget):** Replaced static text pills with a responsive tier strategy:
   - **Tier 1 (≥1440px):** Icon + short uppercase label (~790px total pillar).
   - **Tier 2 (1100px – 1439px):** Icon-only with rich tooltips (~340px total pillar), fitting easily alongside the 140px Windows caption reserve.
   - **Tier 3 (<1100px):** Compact icon track with overflow menu.
   - Set `minWidth: 800` on the Electron window to prevent caption collision.
4. **B4 Resolved (Versioned Schema Migration):** Replaced the naive startup merge with a single-shot schema version gate (`nexus.models.version = 2`). Custom models and deliberate user deletions of ChatGPT or Claude are permanently respected.
5. **B5 Resolved (CSS Precedence Cleaned):** `<TitlebarModelPillar />` sets only `--provider-color` inline. All glow and ambient variables are computed in CSS via `color-mix()` with hex-alpha fallbacks, making TASK-3's recipe fully authoritative.
6. **H2 Resolved (GPU Compositor-Only Animation):** Rebuilt `arcReactorBreathe` on an isolated `::before` pseudo-element animating strictly `opacity` and `transform: scale()`. Zero frame-by-frame paint thrash on X11 or software-rendered setups.
7. **H1 & H4 Resolved (Accessibility & Keyboard Contract):** Applied `inert` when retracted so off-screen titlebars cannot be tabbed into. Implemented WAI-ARIA roving tabindex (Left/Right/Home/End arrow keys) with `role="radiogroup"` and `aria-checked`.

---

## Reading Sequence & Task Breakdown

| Task File | Title | Scope & Addressed Findings |
| :--- | :--- | :--- |
| **[`TASK-1-ACCURATE-AI-PROVIDERS-AND-BRAND-ICONS.md`](TASK-1-ACCURATE-AI-PROVIDERS-AND-BRAND-ICONS.md)** | Provider Registry & Authentic SVGs | B4 (versioned migration), M1 (distinct brand hexes: Claude terracotta vs Arena amber), M2 (CC0-1.0 licensing), M3 (inlined SVG paths for all 8 providers), M4 (downstream mappings in `modelVisuals.ts`). |
| **[`TASK-2-TITLEBAR-EXPANDED-MODEL-PILLAR.md`](TASK-2-TITLEBAR-EXPANDED-MODEL-PILLAR.md)** | Titlebar Component & Layout | B3 (responsive tiers & budget), B5 (inline style clean-up), H4 (roving tabindex arrow contract), M8 (semantic anchor edits). |
| **[`TASK-3-IRON-MAN-ARC-BREATHING-ANIMATION.md`](TASK-3-IRON-MAN-ARC-BREATHING-ANIMATION.md)** | Iron Man Arc-Reactor Glow | H2 (`::before` compositor-only animation), H8 (normalized 85%/15% color-mix), H3 (Electron 43+ support confirmation & hex-alpha fallbacks), M9 (will-change optimization). |
| **[`TASK-4-TITLEBAR-HOVER-AUTOHIDE-MODE.md`](TASK-4-TITLEBAR-HOVER-AUTOHIDE-MODE.md)** | Hover Auto-Hide UX Engine | B1 (window mousemove listener, 0 click-blocking), B2 (150ms dwell filter), H1 (`inert` attribute off-screen), H7 (Windows caption overlay coordination), M6/M7 (timer cleanup & drag contract). |
| **[`TASK-5-VERIFICATION-TESTS-AND-REGRESSIONS.md`](TASK-5-VERIFICATION-TESTS-AND-REGRESSIONS.md)** | QA & Automated Test Suite | H5 (stylesheet AST/regex assertion for `-webkit-app-region`), H6 (5-case localStorage migration suite), M4/M5/M9 (leaf `models.ts` extraction, fake timer hygiene). |

---

## Architectural Diagram

```
+-------------------------------------------------------------------------------------------------------------------------+
|                                                  WINDOW TITLEBAR (h-9)                                                  |
+-------------------------------------------------------------------------------------------------------------------------+
| [O] NEXUS  |  "Active Chat Title"  |        [ (G) (C) (Claude) (DS) (P) (Q) (K) (A) ]        |   [—] [口] [X] / (140px) |
| (Arc Logo) | (Active Conversation) |         (Always-Expanded TitlebarModelPillar)           | (Caption Controls)      |
+-------------------------------------------------------------------------------------------------------------------------+
|                                                    TOP NAVBAR (h-10)                                                    |
+-------------------------------------------------------------------------------------------------------------------------+
|  [Tab 1: Gemini]  [Tab 2: Claude]  [Tab 3: GPT-4o]  [+]                                      | [HUD] [Export] [Settings] |
|                                             (ChatTabs - Full Width Available)                                           |
+-------------------------------------------------------------------------------------------------------------------------+
|                                                                                                                         |
|                                            ACTIVE PROVIDER WEBVIEW (Chromium)                                           |
|                                                                                                                         |
+-------------------------------------------------------------------------------------------------------------------------+
```

---

## Core Invariants & Safety Guarantees

1. **Window Drag & Caption Button Safety:**
   - The titlebar background maintains `-webkit-app-region: drag` for window movement.
   - All interactive elements are strictly stamped with `-webkit-app-region: no-drag !important` in CSS.
   - On Windows, `paddingRight: 140px` is preserved in both standard and floating revealed states.

2. **Zero In-Tab Space Cannibalization:**
   - Removing `ModelNotch` from `top-navbar` grants `ChatTabs` 100% of the middle row, eliminating tab text truncation.

3. **Accessibility & Keyboard Contract:**
   - WAI-ARIA `role="radiogroup"` with roving tabindex: only the active provider has `tabIndex={0}`; arrow keys (Left/Right/Home/End) navigate and switch active providers.
   - When retracted in auto-hide mode, `<header>` receives `inert={true}` so off-screen elements are not focusable.

4. **Zero Persistent Paint Loops:**
   - The breathing animation is isolated to `::before` pseudo-elements altering `opacity` and `transform`, executing on GPU compositing without CPU raster thrash.
