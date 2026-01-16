import { type BrowserWindow, globalShortcut } from "electron";

export class ShortcutManager {
  private currentShortcut: string = "PrintScreen";
  private mainWindow: BrowserWindow | null = null;

  setMainWindow(window: BrowserWindow): void {
    this.mainWindow = window;
  }

  getCurrentShortcut(): string {
    return this.currentShortcut;
  }

  registerShortcut(shortcut: string): boolean {
    if (globalShortcut.isRegistered(shortcut)) {
      globalShortcut.unregister(shortcut);
    }

    const success = globalShortcut.register(shortcut, () => {
      this.handleShortcutTrigger();
    });

    if (!success) {
      return false;
    }

    if (this.currentShortcut && this.currentShortcut !== shortcut) {
      if (globalShortcut.isRegistered(this.currentShortcut)) {
        globalShortcut.unregister(this.currentShortcut);
      }
    }

    this.currentShortcut = shortcut;
    return true;
  }

  handleShortcutTrigger(): void {
    if (this.mainWindow) {
      this.mainWindow.show();
      if (this.mainWindow.isMinimized()) {
        this.mainWindow.restore();
      }
      this.mainWindow.focus();
      this.mainWindow.webContents.send("open-source-picker");
    }
  }

  unregisterAll(): void {
    globalShortcut.unregisterAll();
  }
}
