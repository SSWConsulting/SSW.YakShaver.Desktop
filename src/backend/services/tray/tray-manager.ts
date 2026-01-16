import { app, type BrowserWindow, Menu, nativeImage, Tray } from "electron";
import { getIconPath } from "../../utils/path-utils";

type QuitHandler = () => void;

export class TrayManager {
  private tray: Tray | null = null;
  private mainWindow: BrowserWindow | null = null;
  private onQuitRequested: QuitHandler;

  constructor(onQuitRequested: QuitHandler) {
    this.onQuitRequested = onQuitRequested;
  }

  setMainWindow(window: BrowserWindow): void {
    this.mainWindow = window;
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
    if (this.mainWindow) {
      this.mainWindow.show();
      if (this.mainWindow.isMinimized()) {
        this.mainWindow.restore();
      }
      this.mainWindow.focus();
    }
  }

  private buildTrayContextMenu(): Menu {
    return Menu.buildFromTemplate([
      {
        label: "Open YakShaver",
        click: () => {
          this.showWindow();
        },
      },
      {
        label: `Record Shave`,
        click: () => {
          this.openSourcePicker();
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
    if (this.mainWindow) {
      this.showWindow();
      this.mainWindow.webContents.send("open-source-picker");
    }
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
