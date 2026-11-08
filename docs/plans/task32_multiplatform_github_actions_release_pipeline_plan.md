# Task 32: Multi-Platform GitHub Actions Release Pipeline Plan

## 1. Problem Diagnosis
1. **Missing `.pacman`**:
   - The repository only contained `.github/workflows/release-windows.yml` which ran strictly on `windows-latest` and only built `npm run build:win`. No CI workflow existed to build Linux packages (`.pacman`).
2. **Missing `.exe` on Release Page**:
   - During `release-windows.yml`, passing `GH_TOKEN` to `electron-builder` caused it to automatically draft a release (`isDraft: true`).
   - The subsequent `gh release upload` step never undrafted the release (`gh release edit --draft=false`), causing releases `v1.0.3` through `v1.0.6` to remain as hidden/unpublished drafts invisible on GitHub Releases.
3. **Immediate Remediation Completed**:
   - Built `nexus-1.0.6.pacman` (92.4 MB).
   - Generated `SHA256SUMS-v1.0.6.txt`.
   - Uploaded `nexus-1.0.6.pacman`, `nexus-1.0.6-setup.exe.blockmap`, and `SHA256SUMS-v1.0.6.txt` to the `v1.0.6` release.
   - Published `v1.0.6` release publicly via `gh release edit v1.0.6 --draft=false --latest`.
   - Verified that both `nexus-1.0.6-setup.exe` and `nexus-1.0.6.pacman` are publicly accessible and downloadable.

## 2. Permanent CI Automation Implementation
Create a unified `.github/workflows/release.yml` with:
- **`build-windows` Job**:
  - Runner: `windows-latest`
  - Caches node and Electron downloads
  - Runs `npm ci` and `npm run build:win`
  - Uploads `dist/*.exe`, `dist/*.exe.blockmap`, `dist/latest.yml` as `windows-artifacts`
- **`build-linux` Job**:
  - Runner: `ubuntu-latest`
  - Installs `libarchive-tools` (`bsdtar` required by `fpm` for pacman)
  - Runs `npm ci` and `npm run build:linux`
  - Uploads `dist/*.pacman` and `dist/latest-linux.yml` as `linux-artifacts`
- **`publish-release` Job**:
  - Needs: `[build-windows, build-linux]`
  - Runs on `ubuntu-latest`
  - Gathers all Windows and Linux artifacts into `release-assets/`
  - Computes `SHA256SUMS-${TAG}.txt` across all installer packages
  - Checks if release exists; creates if missing (`gh release create "$TAG" --title "Nexus $TAG" --generate-notes`)
  - Uploads all assets with `gh release upload "$TAG" release-assets/* --clobber`
  - Explicitly executes `gh release edit "$TAG" --draft=false --latest` to ensure public release publication
