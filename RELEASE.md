# Desktop Electron App Release

## Release Workflow

### 1. Create release branch

```bash
git checkout main && git pull
git checkout -b releases/desktop-v1.1.0
git push origin releases/desktop-v1.1.0
```

### 2. QA testing

Build and test on release branch using the same build script. Main continues development.

```bash
cd desktop-electron
npm run make
```

### 3. Create GitHub Release Draft

Visit https://github.com/SSWConsulting/SSW.YakShaver/releases and create draft:
- Tag: `desktop-v1.1.0`
- Target: `releases/desktop-v1.1.0`

### 4. Publish release

Click "Publish release" to trigger automated build.

### 5. Hotfix released version

Keep release branch for hotfixes:

```bash
git checkout releases/desktop-v1.1.0
# Make fixes, commit, push
git checkout main
git cherry-pick <commit-hash>
```

Create new release (v1.1.1) on GitHub with same release branch.

### 6. Cleanup

Merge and delete release branch when stable:

```bash
git checkout main
git merge --no-ff releases/desktop-v1.1.0
git push origin main
git push origin --delete releases/desktop-v1.1.0
```
