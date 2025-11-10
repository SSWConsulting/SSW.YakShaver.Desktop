# Release Channel Feature - Fix Summary

## Problems Identified

### 1. **Update Manifest File Mismatch** (Critical)
**Problem:** When electron-updater is configured with a channel like `pr-123`, it looks for update manifest files named:
- Windows: `pr-123.yml`
- macOS: `pr-123-mac.yml`

However, your PR workflow was only publishing:
- Windows: `latest.yml`
- macOS: `latest-mac.yml`

This meant that when users selected a PR release, electron-updater couldn't find the update files.

**Fix:** Modified `.github/workflows/pr-release.yml` to:
1. Keep the original `latest.yml` files (for backward compatibility)
2. Copy them to channel-specific names (e.g., `pr-123.yml` and `pr-123-mac.yml`)
3. Upload both versions to the GitHub release

### 2. **Version Comparison Logic** (Important)
**Problem:** The version comparison was too simplistic and didn't handle pre-release versions correctly (e.g., `0.3.7-pr.123`).

**Fix:** Implemented proper semver-like comparison in `release-channel-handlers.ts`:
- Parses versions into major.minor.patch + prerelease components
- Correctly handles pre-release identifiers
- Stable versions are considered "newer" than pre-release versions with the same base

### 3. **PR Version Detection Logic** (Important)
**Problem:** When checking for updates on a PR channel, the code was comparing tag names (like `pr-123`) with version strings (like `0.3.7`), which didn't make sense.

**Fix:** Added special handling for PR tags:
- Detects PR tags by the `pr-` prefix
- Extracts PR number and constructs expected version format
- Considers update available if current version doesn't match the target PR version
- This allows users to explicitly switch to a specific PR build

### 4. **Debugging Support** (Nice to have)
**Problem:** Limited logging made it hard to debug update issues.

**Fix:** Added comprehensive console logging throughout the update check process to help troubleshoot issues.

## Changes Made

### 1. `.github/workflows/pr-release.yml`
- Added "Rename update manifest for channel" step for Windows builds (line 88-95)
- Added "Rename update manifest for channel" step for macOS builds (line 179-185)
- Updated file upload sections to include both `latest.yml` and channel-specific yml files

### 2. `src/backend/ipc/release-channel-handlers.ts`
- Enhanced `checkForUpdates()` with better logging and PR-specific logic
- Improved `compareVersions()` to properly handle pre-release versions
- Added logging to `configureAutoUpdater()` for debugging
- Fixed PR version detection to check if user is already on the selected PR version

## How It Works Now

### For PR Releases:
1. When a PR is opened/updated, the workflow:
   - Builds the app with version `X.Y.Z-pr.{PR_NUMBER}`
   - Creates a GitHub release with tag `pr-{PR_NUMBER}`
   - Publishes both `latest.yml` and `pr-{PR_NUMBER}.yml` files (and mac equivalents)
   - Uploads executables

2. When a user selects a PR release in settings:
   - The app configures electron-updater to use channel `pr-{PR_NUMBER}`
   - electron-updater looks for `pr-{PR_NUMBER}.yml` in the GitHub release
   - If the current version doesn't match the PR version, update is available
   - User can click "Check for Updates" to download and install the PR build

### For Latest Releases:
- Uses standard `latest` channel with `latest.yml` files
- Only shows stable (non-prerelease) releases

## Testing Instructions

### Prerequisites:
1. You need a working PR that triggers the `pr-release.yml` workflow
2. The app must be packaged (not running in development mode)
3. You should have at least 2 different versions to test switching between

### Test Scenario 1: Switch from Stable to PR Release
1. Start with a stable version installed (e.g., `0.3.7`)
2. Open Settings → Release Channel
3. Select a PR release from the dropdown (e.g., `pr-123`)
4. Click "Save"
5. Click "Check for Updates"
6. Expected: "Update available! The app will update automatically."
7. The app should download and prompt to restart
8. After restart, verify the version shows `0.3.7-pr.123` (or similar)

### Test Scenario 2: Switch Between PR Releases
1. Start with a PR version installed (e.g., `0.3.7-pr.123`)
2. Select a different PR release (e.g., `pr-456`)
3. Click "Save" and "Check for Updates"
4. Expected: Update should be available
5. After update, version should show `0.3.7-pr.456`

### Test Scenario 3: Switch from PR to Latest
1. Start with a PR version installed
2. Select "Latest Stable (default)"
3. Click "Save" and "Check for Updates"
4. Expected: Update should be available if a stable release exists
5. After update, version should show stable version (e.g., `0.3.7`)

### Test Scenario 4: Already on Selected Version
1. Start with a PR version installed (e.g., `0.3.7-pr.123`)
2. Select the same PR release you're already on
3. Click "Check for Updates"
4. Expected: "You are on the latest version"

### Debugging Tips:
1. Open Electron DevTools (Help → Toggle Developer Tools)
2. Check the Console tab for logs like:
   - `Checking for updates: current version X.X.X, channel: {...}`
   - `Configured autoUpdater for tag channel: pr-123`
   - `PR release: expected version X.X.X-pr.123, current: X.X.X, match: false`
3. Look for errors in the update check process

### Common Issues:
1. **"Release pr-123 not found"**: The PR release workflow hasn't completed yet
2. **"Update checks are only available in packaged applications"**: You're running in dev mode
3. **"GitHub API rate limit exceeded"**: Add a GitHub token to the app's `.env` file
4. **Update doesn't start**: Check the release has the correct `.yml` files uploaded

## File Structure in GitHub Releases

After these changes, each PR release should contain:
- `latest.yml` (Windows manifest, backward compatibility)
- `pr-{NUMBER}.yml` (Windows manifest, for channel selection)
- `latest-mac.yml` (macOS manifest, backward compatibility)
- `pr-{NUMBER}-mac.yml` (macOS manifest, for channel selection)
- `YakShaver Setup X.X.X-pr.{NUMBER}.exe` (Windows installer)
- `YakShaver Setup X.X.X-pr.{NUMBER}.exe.blockmap`
- `YakShaver-X.X.X-pr.{NUMBER}-mac.zip` (macOS app)
- `YakShaver-X.X.X-pr.{NUMBER}-mac.zip.blockmap`

## Next Steps

1. **Test the changes**: Create or update a PR to trigger the workflow
2. **Verify file upload**: Check that both `latest.yml` and `pr-{NUMBER}.yml` are uploaded
3. **Test switching**: Follow the test scenarios above
4. **Monitor logs**: Watch for any errors in the console during updates

## Additional Enhancements (Optional)

You might want to consider:
1. Adding a visual indicator in the UI showing which channel you're currently on
2. Adding a "Download and Install" button instead of just "Check for Updates"
3. Showing release notes when switching versions
4. Adding a confirmation dialog before switching channels
5. Implementing automatic update checking when channel changes

