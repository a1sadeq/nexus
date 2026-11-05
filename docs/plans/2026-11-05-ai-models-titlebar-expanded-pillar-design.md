# AI Models Titlebar Expanded Pillar & Iron Man HUD — System Design Document (v2 Post-Audit)

**Date:** 2026-11-05  
**Status:** Updated & Aligned with Expert Review Audit  
**Author:** Antigravity AI Assistant & Nexus Team  

---

## 1. Executive Summary & Vision

This system design transitions the Nexus AI model selection architecture from an in-tab dynamic island (`ModelNotch`) into an **always-expanded, top-tier AI Models Pillar integrated directly into the custom Electron titlebar** (`WindowTitleBar`).

Following the expert review audit, the specification addresses all 5 critical blockers:
1. **Window Mousemove Auto-Hide:** Zero click interception across the tab strip; eliminates the transparent 4px overlay div.
2. **150ms Dwell Protection:** Cursor crossing the top edge on its way to a tab will not accidentally trigger the floating titlebar.
3. **Three-Tier Responsive Width Strategy:** Accommodates half-snapped 1080p windows (960px) and laptop screens (1366px) down to an 800px minimum window width without caption control collision.
4. **Versioned Storage Migration:** Single-shot upgrade to `nexus.models.version = 2` that permanently respects deliberate user model deletions and preserves custom models.
5. **Compositor-Only Arc-Reactor Breathing:** Uses an isolated `::before` pseudo-element animating strictly `opacity` and `transform: scale()`, running 60 FPS on GPU compositing with zero frame-by-frame paint thrashing.

---

## 2. Requirements & Architecture Decisions

| Requirement | Audit-Aligned Decision & Rationale |
| :--- | :--- |
| **Titlebar Placement & Clearance** | Centered in `WindowTitleBar`. Three responsive tiers (Tier 1 ≥1440px text+icon; Tier 2 1100–1439px icon-only; Tier 3 800–1099px compact). Active conversation title pill moves to the left beside the brand emblem. |
| **Iconography & Providers** | Standardize on verified SVG brand marks for top 8 providers: ChatGPT, Claude (terracotta `#d97757`), Gemini, DeepSeek, Perplexity, Qwen, Kimi, and Arena (`#f59e0b`). Upgraded Arc-Reactor emblem with 2.0px stroke. |
| **Iron Man Glow Effect** | Adaptive Arc-Reactor: each active provider radiates its authentic brand color with an intense inner core + soft breathing neon aura (2.5s pulse keyframes) rendered via a `::before` pseudo-element. |
| **Window Drag Handling** | Strict `-webkit-app-region: no-drag !important` on the pillar container and all buttons, verified via automated stylesheet assertions. |
| **Keyboard & A11y Contract** | WAI-ARIA `role="radiogroup"` with roving tabindex and Arrow key navigation (Left/Right/Home/End). When retracted in auto-hide, `inert={true}` is applied. |
| **Auto-Hide on Hover** | When `interfaceSettings.showTitlebar === false`, a `window` mousemove listener (`clientY <= 4`) with 150ms dwell reveals the titlebar with a 250ms ease-out animation and 300ms leave grace period. `Alt+Shift+T` hotkey available. |

---

## 3. Architecture & Component Hierarchy

```
+-------------------------------------------------------------------------------------------------------------------------+
|                                                   ELECTRON MAIN WINDOW                                                  |
+-------------------------------------------------------------------------------------------------------------------------+
| [O] NEXUS  |  "Active Chat Title"  |        [ (G) (C) (Claude) (DS) (P) (Q) (K) (A) ]        |   [—] [口] [X] / (140px) |
|   (Arc Logo)   (Left Pill)         |             (TitlebarModelPillar)               |   (Window Controls)      |
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

## 4. Key Punch-List Fixes Incorporated

1. **Window-level mousemove hover listener:** Eliminates click-swallowing on the tab strip.
2. **150ms Dwell timer:** Prevents accidental model switches during downward cursor motion.
3. **Three responsive tiers:** Full clearance on 960px half-snapped 1080p screens.
4. **Versioned storage migration:** Schema v2 protects user deletions and custom models.
5. **CSS Precedence fix:** JSX sets only `--provider-color`; CSS derivations compute `--provider-glow`.
6. **Compositor-only keyframes:** GPU offloaded `opacity` and `transform` via `::before` layer.
7. **Color-mix normalization:** Fixed 85%/15% sum; confirmed Electron 43.2.0 compatibility.
8. **Inert attribute:** Off-screen titlebar cannot be tabbed into.
9. **Roving tabindex:** Full keyboard arrow navigation contract implemented.
10. **Leaf models.ts extraction & test matrix:** 5-case migration suite and stylesheet AST tests.
