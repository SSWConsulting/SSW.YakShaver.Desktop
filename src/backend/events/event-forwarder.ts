import { BrowserWindow } from "electron";
import { IPC_CHANNELS } from "../ipc/channels";
import { RecordingService } from "../services/recording/recording-service";
import { RecordingControlBarWindow } from "../services/recording/control-bar-window";

const sendToAll = (channel: string, payload?: unknown) =>
  BrowserWindow.getAllWindows().forEach((win) => {
    if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
      win.webContents.send(channel, payload);
    }
  });

export function registerEventForwarders() {
  const service = RecordingService.getInstance();
  const controlBar = RecordingControlBarWindow.getInstance();

  const handlers = {
    [IPC_CHANNELS.TRANSCRIPTION_STARTED]: () =>
      sendToAll("transcription-started", true),
    [IPC_CHANNELS.TRANSCRIPTION_COMPLETED]: (transcript: string) =>
      sendToAll("transcription-completed", transcript),
    [IPC_CHANNELS.TRANSCRIPTION_ERROR]: (error: string) =>
      sendToAll("transcription-error", error),
    [IPC_CHANNELS.RECORDING_TIME_UPDATE]: (time: number) =>
      controlBar.updateTime(time),
  };

  Object.entries(handlers).forEach(([event, handler]) =>
    service.on(event, handler),
  );

  return () =>
    Object.entries(handlers).forEach(([event, handler]) =>
      service.off(event, handler),
    );
}
