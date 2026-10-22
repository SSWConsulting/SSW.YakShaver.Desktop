import { promises as fs } from "node:fs";
import { app, ipcMain, shell } from "electron";
import { LocalVideoStorageService } from "../services/video/local-video-storage";
import { formatAndReportError } from "../utils/error-utils";
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
        return { success: false, error: formatAndReportError(error, "app_control") };
      }
    });

    ipcMain.handle(IPC_CHANNELS.APP_GET_LOCAL_VIDEO_DIR, async () => {
      try {
        return { success: true, data: LocalVideoStorageService.getInstance().getRootDir() };
      } catch (error) {
        return { success: false, error: formatAndReportError(error, "app_control") };
      }
    });

    // Opens the local recordings folder, or one recording's folder inside it. Anything outside
    // that root is refused so the renderer can't use this to open arbitrary paths.
    ipcMain.handle(IPC_CHANNELS.APP_OPEN_LOCAL_VIDEO_FOLDER, async (_, folder?: string) => {
      try {
        const storage = LocalVideoStorageService.getInstance();
        const target = folder ?? storage.getRootDir();
        if (!storage.isWithinRootDir(target)) {
          return { success: false, error: "Folder is outside the local recordings folder" };
        }
        await fs.mkdir(target, { recursive: true });
        // shell.openPath resolves to an error message (empty on success) rather than rejecting.
        const openError = await shell.openPath(target);
        return openError ? { success: false, error: openError } : { success: true };
      } catch (error) {
        return { success: false, error: formatAndReportError(error, "app_control") };
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
        return { success: false, error: formatAndReportError(error, "app_control") };
      }
    });
  }
}
