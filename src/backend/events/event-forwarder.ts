import { BrowserWindow } from "electron";
import { IPC_CHANNELS } from "../ipc/channels";
import { RecordingControlBarWindow } from "../services/recording/control-bar-window";
import { RecordingService } from "../services/recording/recording-service";

const _sendToAll = (channel: string, payload?: unknown) =>
  BrowserWindow.getAllWindows().forEach((win) => {
    if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
      win.webContents.send(channel, payload);
    }
  });

export function registerEventForwarders() {
  const service = RecordingService.getInstance();
  const controlBar = RecordingControlBarWindow.getInstance();

  const handlers = {
    [IPC_CHANNELS.RECORDING_TIME_UPDATE]: (time: number) => controlBar.updateTime(time),
  };

  Object.entries(handlers).forEach(([event, handler]) => service.on(event, handler));

  return () => Object.entries(handlers).forEach(([event, handler]) => service.off(event, handler));
}
