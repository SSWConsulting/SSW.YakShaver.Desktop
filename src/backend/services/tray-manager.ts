import { join } from "node:path";
import { app, type BrowserWindow, Menu, nativeImage, Tray } from "electron";

export class TrayManager {
  private tray: Tray | null = null;
  private mainWindow: BrowserWindow | null = null;
  private currentRecordShortcut: string = "PrintScreen";
  private isQuittingCallback: () => void;
  private isDev: boolean;
  private onRecordClick: () => void;

  constructor(isDev: boolean, isQuittingCallback: () => void, onRecordClick: () => void) {
    this.isDev = isDev;
    this.isQuittingCallback = isQuittingCallback;
    this.onRecordClick = onRecordClick;
  }

  setMainWindow(window: BrowserWindow): void {
    this.mainWindow = window;
  }

  createTray(): void {
    // Fix icon path for packaged mode
    const iconPath = this.isDev
      ? join(__dirname, "../../src/ui/public/icons/icon.png")
      : join(process.resourcesPath, "public/icons/icon.png");

    const icon = nativeImage.createFromPath(iconPath);
    this.tray = new Tray(icon.resize({ width: 16, height: 16 }));

    this.tray.setToolTip("YakShaver");
    this.updateTrayMenu();

    // Show window on tray icon click
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
        label: "Show",
        click: () => {
          this.showWindow();
        },
      },
      {
        label: `Record Shave (${this.currentRecordShortcut})`,
        click: () => {
          this.onRecordClick();
        },
      },
      { type: "separator" },
      {
        label: "Quit",
        click: () => {
          this.isQuittingCallback();
          app.quit();
        },
      },
    ]);
  }

  updateTrayMenu(shortcut?: string): void {
    if (shortcut) {
      this.currentRecordShortcut = shortcut;
    }
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
