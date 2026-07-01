import { app, type BrowserWindow, type Input } from "electron";

/**
 * Whether this process is running as a packaged production build.
 *
 * Prefer this over `NODE_ENV`-based checks: `NODE_ENV` is only set explicitly
 * by the `npm run dev` script (via `cross-env NODE_ENV=development`) and can
 * be left unset, or leak an unexpected value from whatever shell/CI/installer
 * launched the process. `app.isPackaged` is Electron-native and reflects
 * whether the app is actually running from a packaged asar, independent of
 * the environment — the same reasoning `getIconPath` already relies on.
 */
export function isProductionBuild(): boolean {
  return app.isPackaged;
}

/**
 * Keyboard shortcuts Chromium wires up by default to open DevTools,
 * regardless of whether the app's own Menu exposes a "Toggle DevTools" item.
 * Removing the menu entry alone does not disable these accelerators (see
 * #455) — they have to be intercepted explicitly.
 */
function isDevToolsShortcut(input: Input): boolean {
  if (input.type !== "keyDown") return false;

  const key = input.key.toLowerCase();
  if (key === "f12") return true;

  // Windows/Linux: Ctrl+Shift+I/J/C. macOS: Cmd+Option+I/J/C (Chromium's
  // actual default accelerators there use Option/Alt, not Shift) — also
  // accept Cmd+Shift as a belt-and-suspenders alias.
  const ctrlShift = input.control && input.shift;
  const metaAltOrShift = input.meta && (input.alt || input.shift);
  if (!ctrlShift && !metaAltOrShift) return false;

  return key === "i" || key === "j" || key === "c";
}

/**
 * Locks a window's DevTools access down for production builds.
 *
 * Defense in depth: `webPreferences.devTools: false` (set at window creation)
 * already prevents `webContents.openDevTools()` from doing anything, but this
 * adds a belt-and-suspenders guard against DevTools being reachable through
 * accelerators or being opened by other means (e.g. a future regression that
 * drops the webPreferences flag) — it intercepts the shortcut before Chromium
 * acts on it, and force-closes DevTools if it ever ends up open regardless.
 *
 * No-op outside production so development workflows are unaffected.
 */
export function applyDevToolsGuard(window: BrowserWindow): void {
  if (!isProductionBuild()) return;

  window.webContents.on("before-input-event", (event, input) => {
    if (isDevToolsShortcut(input)) {
      event.preventDefault();
    }
  });

  window.webContents.on("devtools-opened", () => {
    window.webContents.closeDevTools();
  });
}
