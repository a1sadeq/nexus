# Plan: README Power-User Guide

**Date:** 2026-11-02
**Status:** In progress

## Goal

Rewrite `README.md` so a Windows user can install Nexus without help, and an
existing user can discover every feature and self-diagnose problems with the
right-click inspector.

## Audience

1. First-time Windows user — wants a download link, install steps, first launch.
2. Daily power user — wants shortcuts, skills, context export, theming, tabs.
3. Stuck user — wants symptoms, causes, and exact inspector steps.

## Structure (single README, collapsible sections)

1. Hero: name, one-line pitch, badges, screenshot.
2. **Install** — Windows first (SmartScreen steps), then Arch, then build from source.
3. **First 5 minutes** — sign in to providers, pin a tab, open settings.
4. **Feature reference** — one `<details>` block per system:
   - Multi-provider tabs and pinned dock
   - Tab discard / memory management
   - Jarvis HUD, boot sequence, audio
   - Style Studio, themes, per-provider CSS
   - Skills engine and SuperAntigravity frameworks
   - Context compressor and Export Handoff
   - Folder upload and PDF-to-Markdown
   - Cookie/session sync
   - Omnibox, history, tab overview
   - Keyboard matrix (full table)
5. **Troubleshooting** — symptom → cause → fix, with inspector walkthrough:
   - right-click → Inspect Element, Console/Network/Application tabs
   - what to copy, how to redact API keys and cookies
   - blank tab, login not persisting, SmartScreen, GPU jank, version mismatch
6. **Diagnostics** — where logs and config live on Windows/Linux.
7. **Support** — "Just call A1sadeq" contact line.
8. License.

## Rules

- Keep the cyberpunk voice in headings and feature names.
- Install and troubleshooting steps stay plain, numbered, and literal.
- Every claim must match the code; no invented features.
- Use real screenshots in `docs/assets/screenshots/` with redacted identity.
- Add a table of contents for long-page navigation.

## Verification

- Follow the Windows steps on a clean Windows VM or runner.
- Every shortcut in the table exists in `src/renderer/src/lib/shortcuts.ts`.
- Every troubleshooting step is reproducible.
- Markdown renders correctly on GitHub (details, tables, images).
