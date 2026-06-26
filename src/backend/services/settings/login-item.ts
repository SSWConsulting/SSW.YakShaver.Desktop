import { app } from "electron";

/**
 * Registers (or unregisters) the OS "open at login" item to match the desired
 * state.
 *
 * This is the OS-level side effect that must accompany every persisted change
 * to `UserSettings.openAtLogin`. It lives here — not in the storage service —
 * so that every write path (the Settings IPC handler AND the CLI bridge) applies
 * it identically. Persisting the flag without calling this leaves the running
 * app's auto-launch state out of sync with the stored/reported value until the
 * next restart.
 */
export function applyOpenAtLoginSetting(openAtLogin: boolean): void {
  app.setLoginItemSettings({
    openAtLogin,
    openAsHidden: false,
  });
}
