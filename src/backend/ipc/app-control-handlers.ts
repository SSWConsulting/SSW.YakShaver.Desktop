import { app, ipcMain, shell } from "electron";
import { formatErrorMessage } from "../utils/error-utils";
import { IPC_CHANNELS } from "./channels";

export class AppControlIPCHandlers {
  private isAllowedExternalUrl(rawUrl: string): boolean {
    const allowedProtocols = new Set<string>([
      "http:",
      "https:",
      "mailto:",
      "x-apple.systempreferences:",
    ]);

    try {
      const parsed = new URL(rawUrl);
      return allowedProtocols.has(parsed.protocol);
    } catch {
      return false;
    }
  }

  constructor() {
    ipcMain.handle(IPC_CHANNELS.APP_OPEN_EXTERNAL, async (_, url: string) => {
      try {
        if (!this.isAllowedExternalUrl(url)) {
          console.warn("Blocked attempt to open disallowed external URL:", url);
          return { success: false, error: "Disallowed external URL" };
        }
        await shell.openExternal(url);
        return { success: true };
      } catch (error) {
        console.error("Failed to open external url:", error);
        return { success: false, error: formatErrorMessage(error) };
      }
    });

    ipcMain.handle(IPC_CHANNELS.APP_RESTART, async () => {
      try {
        // Give the renderer a moment to show feedback before restarting
        setTimeout(() => {
          app.relaunch();
          app.quit();
        }, 500);

        return { success: true };
      } catch (error) {
        console.error("Failed to restart app:", error);
        return { success: false, error: formatErrorMessage(error) };
      }
    });
  }
}
