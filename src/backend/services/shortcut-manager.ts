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
    // Unregister the new shortcut if it's already registered (safety check)
    if (globalShortcut.isRegistered(shortcut)) {
      globalShortcut.unregister(shortcut);
    }

    // Register new shortcut
    const success = globalShortcut.register(shortcut, () => {
      this.handleShortcutTrigger();
    });

    if (!success) {
      return false;
    }

    // Only unregister the old shortcut AFTER successful registration of the new one
    if (this.currentShortcut && this.currentShortcut !== shortcut) {
      if (globalShortcut.isRegistered(this.currentShortcut)) {
        globalShortcut.unregister(this.currentShortcut);
      }
    }

    // Update current shortcut only after successful registration
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
