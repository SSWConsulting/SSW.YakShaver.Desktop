# YakShaver Desktop Release

## Release Workflow

### 1. Make Changes and Update Version

- Make your changes in a feature branch
- Update the version number in `package.json` to the new version (e.g., `"version": "0.3.0"`)
- Create a Pull Request and get it reviewed

### 2. Create Release Branch

After your PR is merged to `main`:

- Visit https://github.com/SSWConsulting/SSW.YakShaver.Desktop/branches
- Create a new release branch with the format: `releases/v{{VERSION_NUMBER}}`
- Example: `releases/v0.3.0` (matching the version in `package.json`)

### 3. Create GitHub Release

- Visit https://github.com/SSWConsulting/SSW.YakShaver.Desktop/releases
- Create a new release with:
  - Tag: `v{{VERSION_NUMBER}}` (e.g., `v0.3.0`)
  - Target: `releases/v{{VERSION_NUMBER}}` branch
  - Release title: Version number (e.g., `v0.3.0`)

### 4. Publish Release

Click "Publish release" to trigger the automated build and deployment.

---

## Local/QA Testing

To build and test the app locally before release:

```bash
npm run make
```

This will build the application and create distributable packages in the `out` directory.
