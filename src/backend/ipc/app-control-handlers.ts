import { app, ipcMain } from "electron";
import { formatErrorMessage } from "../utils/error-utils";
import { IPC_CHANNELS } from "./channels";

export class AppControlIPCHandlers {
  constructor() {
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
