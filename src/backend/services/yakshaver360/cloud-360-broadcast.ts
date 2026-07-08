import { BrowserWindow } from "electron";
import type { Cloud360EventPayload } from "../../../shared/types/cloud360";
import { IPC_CHANNELS } from "../../ipc/channels";

/** Send one 360 SandboxEvent to every live renderer window. */
export function broadcastCloud360Event(payload: Cloud360EventPayload): void {
  BrowserWindow.getAllWindows()
    .filter((win) => !win.isDestroyed() && !win.webContents.isDestroyed())
    .forEach((win) => {
      win.webContents.send(IPC_CHANNELS.CLOUD360_EVENT, payload);
    });
}
