import { app, type BrowserWindow, Menu, nativeImage, Tray } from "electron";
import { getIconPath } from "../utils/path-utils";
import type { ShortcutManager } from "./shortcut-manager";

interface QuitHandler {
  (): void;
}

export class TrayManager {
  private tray: Tray | null = null;
  private mainWindow: BrowserWindow | null = null;
  private currentRecordShortcut: string = "PrintScreen";
  private shortcutManager: ShortcutManager;
  private onQuitRequested: QuitHandler;

  constructor(shortcutManager: ShortcutManager, onQuitRequested: QuitHandler) {
    this.shortcutManager = shortcutManager;
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
        label: "Show",
        click: () => {
          this.showWindow();
        },
      },
      {
        label: `Record Shave (${this.currentRecordShortcut})`,
        click: () => {
          this.shortcutManager.handleShortcutTrigger();
        },
      },
      { type: "separator" },
      {
        label: "Quit",
        click: () => {
          this.onQuitRequested();
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
