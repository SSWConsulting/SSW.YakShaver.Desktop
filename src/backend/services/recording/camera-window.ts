import { join } from "node:path";
import { BrowserWindow, screen } from "electron";

const WINDOW_SIZE = { width: 400, height: 225 }; // 16:9 aspect ratio
const MARGIN = 20;

export class CameraWindow {
  private static instance: CameraWindow;
  private window: BrowserWindow | null = null;
  private isDev = false;

  static getInstance() {
    CameraWindow.instance ??= new CameraWindow();
    return CameraWindow.instance;
  }

  initialize(isDev: boolean): void {
    this.isDev = isDev;
  }

  async show(
    displayId: string | undefined,
    cameraDeviceId: string
  ): Promise<void> {
    if (this.window) {
      this.window.destroy();
    }

    const { x, y } = this.getPosition(displayId);
    const url = this.isDev
      ? `http://localhost:3000/camera.html?deviceId=${encodeURIComponent(
          cameraDeviceId
        )}`
      : join(
          process.resourcesPath,
          "app.asar.unpacked/src/ui/dist/camera.html"
        );

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

    this.window.setAlwaysOnTop(true, "floating");

    await (this.isDev ? this.window.loadURL(url) : this.window.loadFile(url));

    if (!this.isDev) {
      // Pass device ID via IPC for production mode
      this.window.webContents.send("set-camera-device", cameraDeviceId);
    }

    this.window.showInactive();
  }

  hide() {
    this.window?.destroy();
    this.window = null;
  }

  getWindow(): BrowserWindow | null {
    return this.window;
  }

  private getPosition(displayId?: string) {
    const displays = screen.getAllDisplays();
    const display = displayId
      ? displays.find(
          (d) => d.id.toString() === displayId || d.id === Number(displayId)
        ) ?? screen.getPrimaryDisplay()
      : screen.getPrimaryDisplay();

    const { x, y, width, height } = display.workArea;
    // Position at bottom-right of the screen
    return {
      x: x + width - WINDOW_SIZE.width - MARGIN,
      y: y + height - WINDOW_SIZE.height - MARGIN,
    };
  }
}
