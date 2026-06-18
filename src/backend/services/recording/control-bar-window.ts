import { join } from "node:path";
import { BrowserWindow, screen } from "electron";
import { formatRecordingTime } from "./format-recording-time";

const WINDOW_SIZE = { width: 300, height: 80 };
const MARGIN_BOTTOM = 20;

export class RecordingControlBarWindow {
  private static instance: RecordingControlBarWindow;
  private window: BrowserWindow | null = null;
  private isDev = false;
  // Most recent recording time forwarded from the service, retained so a
  // newly-loaded control bar renderer can be re-synced (#870).
  private latestSeconds: number | null = null;

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

    // The renderer subscribes to time updates on mount, which can complete
    // after the timer has already emitted ticks (more likely on slower/macOS
    // timing). Re-push the latest known time once the page has loaded so the
    // bar isn't stuck on its initial 00:00 (#870).
    this.window.webContents.on("did-finish-load", () => {
      if (this.latestSeconds !== null) {
        this.sendTime(this.latestSeconds);
      }
    });

    this.window.setAlwaysOnTop(true, "screen-saver");

    // Don't include this window in the recording
    this.window.setContentProtection(true);

    await (this.isDev ? this.window.loadURL(url) : this.window.loadFile(url));

    this.window.showInactive();
  }

  hide() {
    this.window?.destroy();
    this.window = null;
    // Clear so the next recording doesn't briefly re-push a stale time on load.
    this.latestSeconds = null;
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
    this.latestSeconds = seconds;
    this.sendTime(seconds);
  }

  private sendTime(seconds: number): void {
    if (this.window && !this.window.isDestroyed()) {
      this.window.webContents.send("update-recording-time", formatRecordingTime(seconds));
    }
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
