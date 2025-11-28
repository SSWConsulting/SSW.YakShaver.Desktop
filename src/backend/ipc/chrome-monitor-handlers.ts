import { ipcMain } from "electron";
import { ChromeDevtoolsMonitorService } from "../services/chrome/chrome-devtools-monitor";
import { IPC_CHANNELS } from "./channels";

export class ChromeMonitorIPCHandlers {
  private service = ChromeDevtoolsMonitorService.getInstance();

  constructor() {
    ipcMain.handle(IPC_CHANNELS.CHROME_MONITOR_GET_STATE, async () => {
      return await this.service.getState();
    });

    ipcMain.handle(IPC_CHANNELS.CHROME_MONITOR_OPEN_BROWSER, async () => {
      return await this.service.openMonitoredChrome();
    });

    ipcMain.handle(IPC_CHANNELS.CHROME_MONITOR_START_CAPTURE, async () => {
      return await this.service.startCapture();
    });

    ipcMain.handle(IPC_CHANNELS.CHROME_MONITOR_STOP_CAPTURE, async () => {
      return await this.service.stopCapture();
    });
  }
}
