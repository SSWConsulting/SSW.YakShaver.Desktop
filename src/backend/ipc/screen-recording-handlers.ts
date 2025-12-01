import { BrowserWindow, ipcMain } from "electron";
import { getMainWindow } from "../index";
import { CameraWindow } from "../services/recording/camera-window";
import { RecordingControlBarWindow } from "../services/recording/control-bar-window";
import { RecordingService } from "../services/recording/recording-service";
import { IPC_CHANNELS } from "./channels";

export class ScreenRecordingIPCHandlers {
  private service = RecordingService.getInstance();
  private controlBar = RecordingControlBarWindow.getInstance();
  private cameraWindow = CameraWindow.getInstance();

  constructor() {
    const handlers = {
      [IPC_CHANNELS.START_SCREEN_RECORDING]: (_: unknown, sourceId?: string) =>
        this.service.handleStartRecording(sourceId),
      [IPC_CHANNELS.STOP_SCREEN_RECORDING]: (
        _: unknown,
        videoData: Uint8Array
      ) => this.service.handleStopRecording(videoData),
      [IPC_CHANNELS.LIST_SCREEN_SOURCES]: () => this.service.listSources(),
      [IPC_CHANNELS.CLEANUP_TEMP_FILE]: (_: unknown, filePath: string) =>
        this.service.cleanupTempFile(filePath),
      [IPC_CHANNELS.SHOW_CONTROL_BAR]: (_: unknown, cameraDeviceId?: string) =>
        this.showControlBarWithCamera(cameraDeviceId),
      [IPC_CHANNELS.HIDE_CONTROL_BAR]: () => this.hideControlBarAndCamera(),
      [IPC_CHANNELS.STOP_RECORDING_FROM_CONTROL_BAR]: () =>
        this.stopRecordingFromControlBar(),
      [IPC_CHANNELS.MINIMIZE_MAIN_WINDOW]: () => this.minimizeMainWindow(),
      [IPC_CHANNELS.RESTORE_MAIN_WINDOW]: () => this.restoreMainWindow(),
    };

    for (const [channel, handler] of Object.entries(handlers)) {
      ipcMain.handle(channel, handler);
    }
  }

  private minimizeMainWindow() {
    const mainWindow = getMainWindow();
    if (mainWindow && !mainWindow.isMinimized()) {
      mainWindow.minimize();
    }
    return { success: true };
  }

  private restoreMainWindow() {
    const mainWindow = getMainWindow();
    if (mainWindow?.isMinimized()) {
      mainWindow.restore();
    }
    return { success: true };
  }

  private async showControlBarWithCamera(cameraDeviceId?: string) {
    const displayId = this.service.getCurrentRecordingDisplayId();

    // Show control bar
    await this.controlBar.showForRecording(displayId);

    // Show camera window if device ID provided
    if (cameraDeviceId) {
      await this.cameraWindow.show(displayId, cameraDeviceId);
    }

    return { success: true };
  }

  private hideControlBarAndCamera() {
    this.cameraWindow.hide();
    this.controlBar.hideWithSuccess();
    return { success: true };
  }

  private stopRecordingFromControlBar() {
    // Hide both camera and control bar
    this.cameraWindow.hide();
    this.controlBar.hide();
    
    // Send stop request to all windows
    BrowserWindow.getAllWindows()
      .filter((win) => !win.isDestroyed() && !win.webContents.isDestroyed())
      .forEach((win) => {
        win.webContents.send("stop-recording-request");
      });
    
    return { success: true };
  }
}
