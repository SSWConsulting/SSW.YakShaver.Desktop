import { join } from "node:path";
import { BrowserWindow, screen, desktopCapturer } from "electron";
import type { RegionBounds } from "./types";

export interface WindowBounds {
  id: string;
  name: string;
  bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

export interface RegionSelectionResult {
  success: boolean;
  region?: RegionBounds;
  cancelled?: boolean;
  error?: string;
}

export class RegionSelectorWindow {
  private static instance: RegionSelectorWindow;
  private window: BrowserWindow | null = null;
  private isDev = false;
  private resolveSelection: ((result: RegionSelectionResult) => void) | null = null;

  static getInstance() {
    RegionSelectorWindow.instance ??= new RegionSelectorWindow();
    return RegionSelectorWindow.instance;
  }

  initialize(isDev: boolean): void {
    this.isDev = isDev;
  }

  async showForDisplay(displayId?: string): Promise<RegionSelectionResult> {
    return new Promise(async (resolve) => {
      this.resolveSelection = resolve;

      // Close any existing window
      this.window?.destroy();

      const displays = screen.getAllDisplays();
      const display = displayId
        ? (displays.find((d) => d.id.toString() === displayId || d.id === Number(displayId)) ??
          screen.getPrimaryDisplay())
        : screen.getPrimaryDisplay();

      const { x, y, width, height } = display.bounds;
      const scaleFactor = display.scaleFactor;

      const url = this.isDev
        ? "http://localhost:3000/region-selector.html"
        : join(process.resourcesPath, "app.asar.unpacked/src/ui/dist/region-selector.html");

      this.window = new BrowserWindow({
        x,
        y,
        width,
        height,
        frame: false,
        transparent: true,
        skipTaskbar: true,
        resizable: false,
        movable: false,
        fullscreen: true,
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
        if (this.resolveSelection) {
          this.resolveSelection({ success: false, cancelled: true });
          this.resolveSelection = null;
        }
      });

      // Don't include this window in the recording
      this.window.setContentProtection(true);
      this.window.setAlwaysOnTop(true, "screen-saver");

      await (this.isDev ? this.window.loadURL(url) : this.window.loadFile(url));

      // Send display info to the renderer
      this.window.webContents.send("region-selector-init", {
        displayId: display.id.toString(),
        scaleFactor,
        bounds: { x, y, width, height },
      });

      this.window.show();
    });
  }

  async getWindowBoundsForDisplay(displayId?: string): Promise<WindowBounds[]> {
    // Get all window sources
    const sources = await desktopCapturer.getSources({
      types: ["window"],
      fetchWindowIcons: false,
      thumbnailSize: { width: 1, height: 1 },
    });

    // Note: Electron's desktopCapturer doesn't provide window bounds
    // We return the windows but bounds will need to be detected on the frontend
    // using mouse hover detection or other methods
    return sources
      .filter((source) => !source.display_id) // Windows don't have display_id
      .map((source) => ({
        id: source.id,
        name: source.name,
        bounds: { x: 0, y: 0, width: 0, height: 0 }, // Bounds not available from Electron API
      }));
  }

  confirmSelection(region: RegionBounds): void {
    if (this.resolveSelection) {
      this.resolveSelection({ success: true, region });
      this.resolveSelection = null;
    }
    this.hide();
  }

  cancelSelection(): void {
    if (this.resolveSelection) {
      this.resolveSelection({ success: false, cancelled: true });
      this.resolveSelection = null;
    }
    this.hide();
  }

  hide(): void {
    this.window?.destroy();
    this.window = null;
  }
}
