import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Replicate Electron's `app.getPath('userData')` for a plain Node process.
 *
 * The desktop app stores config under `<appData>/YakShaver` (or
 * `<appData>/YakShaverDev` in development — see src/backend/index.ts). The CLI
 * is NOT Electron, so we recompute the per-OS appData location here.
 *
 * Electron's appData maps to:
 *   - Windows: %APPDATA%            (C:\Users\<user>\AppData\Roaming)
 *   - macOS:   ~/Library/Application Support
 *   - Linux:   $XDG_CONFIG_HOME or ~/.config
 *
 * The userData folder name is the Electron app name ("YakShaver"), overridden to
 * "YakShaverDev" when running against a dev build.
 */
export function getAppDataDir(): string {
  if (process.platform === "win32") {
    return process.env.APPDATA ?? join(homedir(), "AppData", "Roaming");
  }
  if (process.platform === "darwin") {
    return join(homedir(), "Library", "Application Support");
  }
  return process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config");
}

/** Resolve the YakShaver userData directory. Pass `dev: true` for a dev build. */
export function getUserDataDir(dev = isDevEnv()): string {
  const appName = dev ? "YakShaverDev" : "YakShaver";
  return join(getAppDataDir(), appName);
}

/**
 * Whether to target the dev build's userData. Controlled by the
 * YAKSHAVER_ENV=development env var or a `--dev` flag handled by the caller.
 */
export function isDevEnv(): boolean {
  return process.env.YAKSHAVER_ENV === "development" || process.env.NODE_ENV === "development";
}
