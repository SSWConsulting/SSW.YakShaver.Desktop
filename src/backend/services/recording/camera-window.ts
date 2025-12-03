import { join } from "node:path";
import { BrowserWindow, screen } from "electron";

const WINDOW_SIZE = { width: 400, height: 225 }; // 16:9 aspect ratio
const MARGIN = 20;
const SNAP_MARGIN = 10;

export class CameraWindow {
  private static instance: CameraWindow;
  private window: BrowserWindow | null = null;
  private isDev = false;
  private targetDisplayId: string | undefined;

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

    this.targetDisplayId = displayId;
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

    this.window.on("moved", () => {
      this.snapToScreenEdge();
    });

    this.window.setAlwaysOnTop(true, "floating");

    await (this.isDev ? this.window.loadURL(url) : this.window.loadFile(url));

    if (!this.isDev) {
      this.window.webContents.send("set-camera-device", cameraDeviceId);
    }

    await new Promise<void>((resolve) => {
      const { ipcMain } = require("electron");
      const handler = () => {
        ipcMain.removeListener("camera-ready", handler);
        resolve();
      };
      ipcMain.once("camera-ready", handler);

      setTimeout(() => {
        ipcMain.removeListener("camera-ready", handler);
        resolve();
      }, 5000);
    });

    this.window.showInactive();
  }

  hide() {
    this.window?.destroy();
    this.window = null;
    this.targetDisplayId = undefined;
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
    return {
      x: x + width - WINDOW_SIZE.width - MARGIN,
      y: y + height - WINDOW_SIZE.height - MARGIN,
    };
  }

  private snapToScreenEdge() {
    if (!this.window) return;

    const [windowX, windowY] = this.window.getPosition();
    const { width: windowWidth, height: windowHeight } = WINDOW_SIZE;

    const displays = screen.getAllDisplays();
    const targetDisplay = this.targetDisplayId
      ? displays.find(
          (d) =>
            d.id.toString() === this.targetDisplayId ||
            d.id === Number(this.targetDisplayId)
        ) ?? screen.getPrimaryDisplay()
      : screen.getPrimaryDisplay();

    if (!targetDisplay) return;

    const {
      x: displayX,
      y: displayY,
      width: displayWidth,
      height: displayHeight,
    } = targetDisplay.workArea;
    const displayRight = displayX + displayWidth;
    const displayBottom = displayY + displayHeight;

    let newX = windowX;
    let newY = windowY;

    // Check if window has moved outside the target display and snap it back
    // Left edge
    if (windowX < displayX) {
      newX = displayX + SNAP_MARGIN;
    } else if (windowX < displayX + SNAP_MARGIN) {
      newX = displayX + SNAP_MARGIN;
    }
    // Right edge
    else if (windowX + windowWidth > displayRight) {
      newX = displayRight - windowWidth - SNAP_MARGIN;
    } else if (windowX + windowWidth > displayRight - SNAP_MARGIN) {
      newX = displayRight - windowWidth - SNAP_MARGIN;
    }

    // Top edge
    if (windowY < displayY) {
      newY = displayY + SNAP_MARGIN;
    } else if (windowY < displayY + SNAP_MARGIN) {
      newY = displayY + SNAP_MARGIN;
    }
    // Bottom edge
    else if (windowY + windowHeight > displayBottom) {
      newY = displayBottom - windowHeight - SNAP_MARGIN;
    } else if (windowY + windowHeight > displayBottom - SNAP_MARGIN) {
      newY = displayBottom - windowHeight - SNAP_MARGIN;
    }

    if (newX !== windowX || newY !== windowY) {
      this.window.setPosition(newX, newY);
    }
  }
}
