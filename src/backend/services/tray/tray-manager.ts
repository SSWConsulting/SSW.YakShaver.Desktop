import { app, type BrowserWindow, Menu, nativeImage, Tray } from "electron";
import { IPC_CHANNELS } from "../../ipc/channels";
import { getIconPath } from "../../utils/path-utils";

type QuitHandler = () => void;

export class TrayManager {
  private tray: Tray | null = null;
  private mainWindow: BrowserWindow | null = null;
  private onQuitRequested: QuitHandler;
  private recordHotkeyString = "";

  constructor(onQuitRequested: QuitHandler) {
    this.onQuitRequested = onQuitRequested;
  }

  setMainWindow(window: BrowserWindow): void {
    this.mainWindow = window;

    window.once("closed", () => {
      if (this.mainWindow === window) {
        this.mainWindow = null;
      }
    });
  }

  setRecordHotkey(hotkey: string): void {
    this.recordHotkeyString = hotkey;
    this.updateTrayMenu();
  }

  createTray(): void {
    const icon = nativeImage.createFromPath(getIconPath());
    this.tray = new Tray(icon.resize({ width: 16, height: 16 }));

    this.tray.setToolTip("YakShaver");
    this.updateTrayMenu();

    this.tray.on("click", () => {
      this.showWindow();
    });
  }

  private showWindow(): void {
    const window = this.getActiveMainWindow();

    if (!window) {
      return;
    }

    window.show();
    if (window.isMinimized()) {
      window.restore();
    }
    window.focus();
  }

  private buildTrayContextMenu(): Menu {
    const recordLabel = this.recordHotkeyString
      ? `Record Shave (${this.recordHotkeyString})`
      : "Record Shave";

    return Menu.buildFromTemplate([
      {
        label: recordLabel,
        click: () => {
          this.openSourcePicker();
        },
      },
      { type: "separator" },
      {
        label: "Open YakShaver",
        click: () => {
          this.showWindow();
        },
      },
      { type: "separator" },
      {
        label: "Quit YakShaver",
        click: () => {
          this.onQuitRequested();
          app.quit();
        },
      },
    ]);
  }

  private openSourcePicker(): void {
    const window = this.getActiveMainWindow();

    if (!window || window.webContents.isDestroyed()) {
      return;
    }

    this.showWindow();
    window.webContents.send(IPC_CHANNELS.OPEN_SOURCE_PICKER);
  }

  private getActiveMainWindow(): BrowserWindow | null {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) {
      this.mainWindow = null;
      return null;
    }

    return this.mainWindow;
  }

  updateTrayMenu(): void {
    if (this.tray) {
      this.tray.setContextMenu(this.buildTrayContextMenu());
    }
  }

  destroy(): void {
    if (this.tray) {
      this.tray.destroy();
      this.tray = null;
    }
  }
}
