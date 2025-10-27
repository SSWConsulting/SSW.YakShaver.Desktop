import { join } from "node:path";
import { BrowserWindow, screen } from "electron";

const WINDOW_SIZE = { width: 300, height: 80 };
const MARGIN_BOTTOM = 20;

export class RecordingControlBarWindow {
  private static instance: RecordingControlBarWindow;
  private window: BrowserWindow | null = null;
  private isDev = false;

  static getInstance() {
    RecordingControlBarWindow.instance ??= new RecordingControlBarWindow();
    return RecordingControlBarWindow.instance;
  }

  initialize(isDev: boolean): void {
    this.isDev = isDev;
  }

  async showAtDisplay(displayId?: string): Promise<void> {
    this.window?.destroy();

    const { x, y } = this.getPosition(displayId);
    const url = this.isDev
      ? "http://localhost:3000/control-bar.html"
      : join(process.resourcesPath, "app.asar.unpacked/src/ui/dist/control-bar.html");

    this.window = new BrowserWindow({
      ...WINDOW_SIZE,
      x,
      y,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      show: false,
      webPreferences: {
        preload: join(__dirname, "../../preload.js"),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    this.window.on("closed", () => {
      this.window = null;
    });

    await (this.isDev ? this.window.loadURL(url) : this.window.loadFile(url));

    this.window.showInactive();
  }

  hide() {
    this.window?.destroy();
    this.window = null;
  }

  async showForRecording(displayId?: string) {
    await this.showAtDisplay(displayId);
    return { success: true };
  }

  hideWithSuccess() {
    this.hide();
    return { success: true };
  }

  stopRecordingFromControlBar() {
    this.hide();
    BrowserWindow.getAllWindows()
      .filter((win) => !win.isDestroyed() && !win.webContents.isDestroyed())
      .forEach((win) => {
        win.webContents.send("stop-recording-request");
      });
    return { success: true };
  }

  updateTime(seconds: number): void {
    if (this.window && !this.window.isDestroyed()) {
      this.window.webContents.send("update-recording-time", this.formatTime(seconds));
    }
  }

  private formatTime(seconds: number): string {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    const pad = (n: number) => n.toString().padStart(2, "0");
    return hrs > 0 ? `${pad(hrs)}:${pad(mins)}:${pad(secs)}` : `${pad(mins)}:${pad(secs)}`;
  }

  private getPosition(displayId?: string) {
    const displays = screen.getAllDisplays();
    const display = displayId
      ? (displays.find((d) => d.id.toString() === displayId || d.id === Number(displayId)) ??
        screen.getPrimaryDisplay())
      : screen.getPrimaryDisplay();

    const { x, y, width, height } = display.workArea;
    return {
      x: x + (width - WINDOW_SIZE.width) / 2,
      y: y + height - WINDOW_SIZE.height - MARGIN_BOTTOM,
    };
  }
}
