import { join } from "node:path";
import { BrowserWindow, dialog, screen } from "electron";

export class ScreenFrameWindow {
  private static instance: ScreenFrameWindow;
  private window: BrowserWindow | null = null;
  private isDev = false;

  static getInstance() {
    ScreenFrameWindow.instance ??= new ScreenFrameWindow();
    return ScreenFrameWindow.instance;
  }

  initialize(isDev: boolean): void {
    this.isDev = isDev;
  }

  show(displayId?: string): void {
    if (this.window) {
      this.window.destroy();
    }

    const { x, y, width, height } = this.getDisplayBounds(displayId);
    const url = this.isDev
      ? "http://localhost:3000/frame-overlay.html"
      : join(process.resourcesPath, "app.asar.unpacked/src/ui/dist/frame-overlay.html");

    dialog.showMessageBox({
      type: "info",
      title: "Screen Recording",
      message: "displayId: " + displayId,
      buttons: ["OK"],
    });
    this.window = new BrowserWindow({
      x,
      y,
      width,
      height,
      frame: false,
      transparent: true,
      skipTaskbar: true,
      resizable: false,
      show: false,
      alwaysOnTop: true,
      webPreferences: {
        preload: join(__dirname, "../../preload.js"),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    this.window.on("closed", () => {
      this.window = null;
    });

    this.window.setAlwaysOnTop(true, "screen-saver");
    this.window.setIgnoreMouseEvents(true);

    this.isDev
      ? this.window.loadURL(url)
      : this.window.loadFile(url);

    this.window.showInactive();
  }

  hide() {
    this.window?.destroy();
    this.window = null;
  }

  private getDisplayBounds(displayId?: string) {
    const displays = screen.getAllDisplays();
    const display = displayId
      ? (displays.find((d) => d.id.toString() === displayId || d.id === Number(displayId)) ??
        screen.getPrimaryDisplay())
      : screen.getPrimaryDisplay();
    return display.bounds;
  }
}
