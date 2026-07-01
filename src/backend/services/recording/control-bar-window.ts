import { join } from "node:path";
import { BrowserWindow, screen } from "electron";
import { applyDevToolsGuard, isProductionBuild } from "../../utils/devtools-guard";
import { formatRecordingTime } from "./format-recording-time";

const WINDOW_SIZE = { width: 300, height: 80 };
const MARGIN_BOTTOM = 20;

export class RecordingControlBarWindow {
  private static instance: RecordingControlBarWindow;
  private window: BrowserWindow | null = null;
  private isDev = false;
  // Most recent recording time forwarded from the service, retained so the
  // control bar renderer can be re-synced via the mount handshake (#870).
  private latestSeconds: number | null = null;
  // Resolves the live elapsed time when the renderer requests it on mount.
  // Injected so this window stays decoupled from RecordingService.
  private getElapsedSeconds: (() => number | null) | null = null;

  static getInstance() {
    RecordingControlBarWindow.instance ??= new RecordingControlBarWindow();
    return RecordingControlBarWindow.instance;
  }

  initialize(isDev: boolean): void {
    this.isDev = isDev;
  }

  // Provide a source of truth for the live elapsed time so the renderer's
  // mount handshake can be answered with the current value.
  setElapsedProvider(provider: () => number | null): void {
    this.getElapsedSeconds = provider;
  }

  // Answer the renderer's on-mount request for the current time. The renderer
  // calls this immediately after it has subscribed to time updates, which
  // closes the drop-before-subscribe race: regardless of whether the renderer
  // mounted before or after the first push, it pulls the authoritative value
  // here. Prefers the live elapsed time, falling back to the last pushed value.
  getCurrentTime(): string | null {
    const seconds = this.getElapsedSeconds?.() ?? this.latestSeconds;
    return seconds === null || seconds === undefined ? null : formatRecordingTime(seconds);
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
        devTools: !isProductionBuild(),
      },
    });

    applyDevToolsGuard(this.window);

    this.window.on("closed", () => {
      this.window = null;
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
    // Clear so a new recording's mount handshake doesn't fall back to a stale
    // time before the live elapsed provider reports the fresh recording.
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
    if (this.window && !this.window.isDestroyed() && !this.window.webContents.isDestroyed()) {
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
