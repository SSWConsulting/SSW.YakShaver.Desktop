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

  // async showForDisplay(displayId?: string): Promise<RegionSelectionResult> {
  //   return new Promise(async (resolve) => {
  //     this.resolveSelection = resolve;

  //     // Close any existing window
  //     this.window?.destroy();

  //     const displays = screen.getAllDisplays();
  //     console.log("[RegionSelectorWindow] available displays:", displays.map(d => ({ id: d.id, bounds: d.bounds, scaleFactor: d.scaleFactor })));
  //     const display = displayId
  //       ? (displays.find((d) => d.id.toString() === displayId || d.id === Number(displayId)) ??
  //         screen.getPrimaryDisplay())
  //       : screen.getPrimaryDisplay();

  //     const { x, y, width, height } = display.bounds;
  //     const scaleFactor = display.scaleFactor;
  //     console.log(`[RegionSelectorWindow] Creating overlay for display ${display.id}:`, {
  //     bounds: display.bounds,
  //     scaleFactor,
  //     workArea: display.workArea,
  //   });

  //     console.log(`Showing region selector on display ${display.id} at ${x},${y} (${width}x${height}) with scale factor ${scaleFactor}`);
      
  //     const url = this.isDev
  //       ? "http://localhost:3000/region-selector.html"
  //       : join(process.resourcesPath, "app.asar.unpacked/src/ui/dist/region-selector.html");

  //     this.window = new BrowserWindow({
  //       x,
  //       y,
  //       width,
  //       height,
  //       frame: false,
  //       transparent: true,
  //       skipTaskbar: true,
  //       resizable: false,
  //       movable: false,
  //       show: false,
  //       kiosk: false,
  //       enableLargerThanScreen: false,
  //       alwaysOnTop: true,
  //       webPreferences: {
  //         preload: join(__dirname, "../../preload.js"),
  //         contextIsolation: true,
  //         nodeIntegration: false,
  //       },
  //     });

  //     console.log("[RegionSelectorWindow] BrowserWindow created (will load selector UI)", { x, y, width, height, fullscreen: this.window.isFullScreen() });

  //     // Lock the window to the specific display
  //   this.window.setBounds({ x, y, width, height }, false);
    
  //   // Prevent the window from being moved or resized
  //   this.window.setMaximumSize(width, height);
  //   this.window.setMinimumSize(width, height);

  //     this.window.on("closed", () => {
  //       this.window = null;
  //       if (this.resolveSelection) {
  //         this.resolveSelection({ success: false, cancelled: true });
  //         this.resolveSelection = null;
  //       }
  //     });

  //     // Don't include this window in the recording
  //     this.window.setContentProtection(true);
  //     this.window.setAlwaysOnTop(true, "screen-saver");

  //     await (this.isDev ? this.window.loadURL(url) : this.window.loadFile(url));

  //     // Send display info to the renderer
  //     const initPayload = { displayId: display.id.toString(), scaleFactor, bounds: { x, y, width, height } };
  //     console.log("[RegionSelectorWindow] sending region-selector-init", initPayload);
  //     this.window.webContents.send("region-selector-init", initPayload);

  //     this.window.show();
  //     console.log("[RegionSelectorWindow] region selector window shown");

  //   // VERIFICATION: Check actual bounds after show - for debug
  //   setTimeout(() => {
  //     if (this.window) {
  //       const actualBounds = this.window.getBounds();
  //       const contentBounds = this.window.getContentBounds();
  //       const isFullscreen = this.window.isFullScreen();
  //       const isMaximized = this.window.isMaximized();
        
  //       console.log('[RegionSelectorWindow] POST-SHOW verification:', {
  //         expected: { x, y, width, height },
  //         actualBounds,
  //         contentBounds,
  //         isFullscreen,
  //         isMaximized,
  //         display: display.id,
  //       });
        
  //       // Check if bounds are wrong
  //       if (actualBounds.width !== width || actualBounds.height !== height ||
  //           actualBounds.x !== x || actualBounds.y !== y) {
  //         console.error('[RegionSelectorWindow] BOUNDS MISMATCH! Forcing correction...');
  //         this.window.setBounds({ x, y, width, height }, true);
          
  //         // Check again
  //         setTimeout(() => {
  //           const correctedBounds = this.window?.getBounds();
  //           console.log('[RegionSelectorWindow] After correction:', correctedBounds);
  //         }, 100);
  //       }
  //     }
  //   }, 100);
  //   });
  // }

async showForDisplay(displayId?: string): Promise<RegionSelectionResult> {
  return new Promise(async (resolve) => {
    this.resolveSelection = resolve;
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
      width,
      height,
      frame: false,
      transparent: true,
      skipTaskbar: true,
      resizable: false,
      movable: false,
      show: false,
      alwaysOnTop: true,
      maximizable: false,
      minimizable: false,
      fullscreenable: false,
      webPreferences: {
        preload: join(__dirname, "../../preload.js"),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    this.window.setMaximumSize(width, height);
    this.window.setMinimumSize(width, height);

    this.window.on("closed", () => {
      this.window = null;
      if (this.resolveSelection) {
        this.resolveSelection({ success: false, cancelled: true });
        this.resolveSelection = null;
      }
    });

    this.window.setContentProtection(true);
    this.window.setAlwaysOnTop(true, "screen-saver");

    await (this.isDev ? this.window.loadURL(url) : this.window.loadFile(url));

    // Try to set the desired position
    this.window.setBounds({ x, y, width, height }, true);
    
    // Wait a bit for Windows to settle
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Get the ACTUAL position Windows gave us
    const actualBounds = this.window.getBounds();
    
    console.log('[RegionSelectorWindow] Position comparison:', {
      requested: { x, y },
      actual: { x: actualBounds.x, y: actualBounds.y },
      offset: { 
        x: actualBounds.x - x, 
        y: actualBounds.y - y 
      }
    });

    // Send the ACTUAL window position along with the display info
    // This way the renderer knows both where the window really is
    // and where the display is
    this.window.webContents.send("region-selector-init", {
      displayId: display.id.toString(),
      scaleFactor,
      bounds: { x, y, width, height }, // Display bounds
      windowBounds: { 
        x: actualBounds.x, 
        y: actualBounds.y, 
        width: actualBounds.width, 
        height: actualBounds.height 
      }, // Actual window position
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
