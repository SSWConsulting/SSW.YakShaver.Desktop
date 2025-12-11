import { type IpcMainInvokeEvent, ipcMain } from "electron";
import {
  type VideoHostingSettings,
  VideoHostingSettingsStorage,
} from "../services/storage/video-hosting-settings-storage";
import { IPC_CHANNELS } from "./channels";

export class VideoHostingSettingsIPCHandlers {
  private readonly storage: VideoHostingSettingsStorage;

  constructor() {
    this.storage = VideoHostingSettingsStorage.getInstance();
    this.registerHandlers();
  }

  private registerHandlers(): void {
    ipcMain.handle(IPC_CHANNELS.VIDEO_HOSTING_SETTINGS_GET, async () => {
      return await this.storage.getSettingsAsync();
    });

    ipcMain.handle(
      IPC_CHANNELS.VIDEO_HOSTING_SETTINGS_SET,
      async (_event: IpcMainInvokeEvent, settings: VideoHostingSettings) => {
        await this.storage.setSettingsAsync(settings);
        return { success: true };
      },
    );

    ipcMain.handle(IPC_CHANNELS.VIDEO_HOSTING_SETTINGS_TEST_CONNECTION, async () => {
      return await this.storage.testConnection();
    });
  }
}
