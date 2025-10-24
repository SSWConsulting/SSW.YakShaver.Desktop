import { ipcMain, BrowserWindow } from "electron";
import { RecordingService } from "../services/recording/recording-service";
import { RecordingControlBarWindow } from "../services/recording/control-bar-window";
import { IPC_CHANNELS } from "./channels";

export class ScreenRecordingIPCHandlers {
  private service = RecordingService.getInstance();
  private controlBar = RecordingControlBarWindow.getInstance();

  constructor() {
    Object.entries({
      [IPC_CHANNELS.START_SCREEN_RECORDING]: (_: unknown, sourceId?: string) =>
        this.service.handleStartRecording(sourceId),
      [IPC_CHANNELS.STOP_SCREEN_RECORDING]: (_: unknown, videoData: Uint8Array) =>
        this.service.handleStopRecording(videoData),
      [IPC_CHANNELS.LIST_SCREEN_SOURCES]: () => this.service.listSources(),
      [IPC_CHANNELS.CLEANUP_TEMP_FILE]: (_: unknown, filePath: string) =>
        this.service.cleanupTempFile(filePath),
      [IPC_CHANNELS.TRIGGER_TRANSCRIPTION]: (_: unknown, filePath: string) =>
        this.service.triggerTranscription(filePath),
      [IPC_CHANNELS.SHOW_CONTROL_BAR]: () => 
        this.controlBar.showForRecording(this.service.getCurrentRecordingDisplayId()),
      [IPC_CHANNELS.HIDE_CONTROL_BAR]: () => 
        this.controlBar.hideWithSuccess(),
      [IPC_CHANNELS.STOP_RECORDING_FROM_CONTROL_BAR]: () => 
        this.controlBar.stopRecordingFromControlBar(),
    }).forEach(([channel, handler]) => ipcMain.handle(channel, handler));
  }
}
