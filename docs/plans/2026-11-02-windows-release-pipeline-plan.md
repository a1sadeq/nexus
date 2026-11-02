# Plan: Windows v1.0.2 Release Pipeline

**Date:** 2026-11-02
**Status:** In progress
**Owner:** Release

## Goal

Ship a working Windows installer for Nexus v1.0.2 to GitHub Releases, plus the
matching Arch package, and make future Windows releases one-click repeatable.

## Why this exists

- `v1.0.1` currently carries a corrupted 431 KB `nexus-1.0.0-setup.exe`.
- The good installer was overwritten by a failed Wine build.
- There is no CI workflow, so every Windows build depends on this Linux host.

## Decisions

| Decision | Choice |
| --- | --- |
| Build path | GitHub Actions on `windows-latest`, with local Wine build as fallback |
| Version | `1.0.2` (package.json + tag) |
| Assets | Windows `.exe` + Arch `.pacman` |
| Signing | Unsigned; document SmartScreen in README |

## Steps

1. Bump `package.json` version to `1.0.2`.
2. Add `.github/workflows/release-windows.yml`:
   - trigger on `v*` tags and `workflow_dispatch`
   - `npm ci`, `npm run build:win`
   - create the release if missing, upload `dist/*.exe` with `--clobber`
3. Exclude `scripts/`, `docs/`, `design-system/` from the packaged asar.
4. Build locally as a fallback:
   `npm run build:win` (verified working: 100,613,665 bytes).
5. Build `nexus-1.0.2.pacman` locally with `npm run build:linux`.
6. Commit, tag `v1.0.2`, push `main` + tag.
7. Let Actions produce the authoritative exe; upload pacman manually.
8. Delete the corrupted `nexus-1.0.0-setup.exe` from `v1.0.1`.
9. Verify release assets: size, SHA256, download + install on Windows.

## Acceptance criteria

- `v1.0.2` release contains `nexus-1.0.2-setup.exe` (~100 MB) and
  `nexus-1.0.2.pacman` (~91 MB).
- Downloaded exe installs, launches, and shows v1.0.2.
- `v1.0.1` no longer exposes a broken installer.
- Re-running the workflow on a new tag publishes a new exe without manual work.

## Risks

- Unsigned exe triggers SmartScreen; mitigated by documentation, not by signing.
- Actions minutes: Windows runner ~5-10 min per build.
- `gh` token needs `workflow` scope to push the workflow file.
