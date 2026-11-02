# Plan: Screenshot Capture for README

**Date:** 2026-11-02
**Status:** In progress

## Goal

Capture accurate, high-resolution screenshots of the real Nexus UI using the
owner's logged-in profile, covering every popup/overlay, with identity details
redacted before publishing.

## Environment

- Dedicated `Xvfb` display at 2560x1600 (not the user's live desktop).
- Isolated profile: copy `~/.config/nexus` to a temp `XDG_CONFIG_HOME` so the
  real session is never mutated.
- Launch the built app (`npm run dev` or packaged Linux build).
- Drive UI with `xdotool`; capture with ImageMagick `import`.
- Software GL if GPU is unavailable; verify blur/aura still render.

## Popup inventory

| # | Surface | How to open |
| --- | --- | --- |
| 1 | Main shell + provider tab | launch |
| 2 | New Tab / model launcher | Ctrl+T |
| 3 | Settings — Appearance | Ctrl+, |
| 4 | Settings — Providers | Ctrl+, → Providers |
| 5 | Settings — Skills | Ctrl+, → Skills |
| 6 | Settings — Shortcuts | Ctrl+, → Shortcuts |
| 7 | Style Studio canvas | Settings → Style Studio |
| 8 | Skills Palette | Ctrl+S |
| 9 | Base Skills framework | Ctrl+Shift+S |
| 10 | Skill parameter modal | run a parameterized skill |
| 11 | Skill editor modal | create/edit skill |
| 12 | Category manager | Skills settings |
| 13 | History overlay | Ctrl+H |
| 14 | Tab overview | Ctrl+Shift+A |
| 15 | URL / omnibox | Ctrl+L |
| 16 | Export handoff | Ctrl+Shift+E |
| 17 | Helper guide | F1 |
| 18 | Folder upload | Ctrl+Shift+O |
| 19 | Right-click context menu | right-click a provider page |
| 20 | Inspector / DevTools | right-click → Inspect Element |
| 21 | Download toast | trigger a download |
| 22 | Sync reminder banner | first launch without sync |

## Redaction

- Blur account email, avatar, and any visible token/key.
- Keep chat content and provider names visible.
- Use ImageMagick `-region` blur or draw boxes; keep originals out of the repo.

## Output

- `docs/assets/screenshots/<surface>.png`
- 2x scale, PNG, cropped to the app window, no desktop background.
- Optional hero GIF: tab switching + settings (ffmpeg from PNG frames).

## Acceptance

- Every listed popup has a screenshot or a documented reason it is unavailable.
- No emails, tokens, or personal identifiers remain.
- README image paths resolve on GitHub.
