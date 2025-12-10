import { BrowserWindow, ipcMain, screen } from "electron";
import { join } from "node:path";
import { IPC_CHANNELS } from "../../ipc/channels";

export interface SelectionRegion {
  x: number;
  y: number;
  width: number;
  height: number;
  displayId?: string;
}

export class SelectionOverlayWindow {
  private static instance: SelectionOverlayWindow;
  private windows: BrowserWindow[] = [];
  private highlightWindow: BrowserWindow | null = null;
  private isDev = false;

  static getInstance() {
    SelectionOverlayWindow.instance ??= new SelectionOverlayWindow();
    return SelectionOverlayWindow.instance;
  }

  initialize(isDev: boolean): void {
    this.isDev = isDev;
  }

  async startSelection(
    displayId?: string
  ): Promise<{ cancelled: true } | SelectionRegion> {
    this.hide();

    const targets = displayId
      ? [this.getDisplayBounds(displayId)]
      : screen
          .getAllDisplays()
          .map((d) => this.getDisplayBounds(d.id.toString()));

    const selectionPromise = new Promise<{ cancelled: true } | SelectionRegion>(
      (resolve) => {
        const handleComplete = (_: unknown, region: SelectionRegion) => {
          resolve({
            ...region,
            displayId: region.displayId ?? region.displayId,
          });
          cleanupListeners();
        };
        const handleCancel = () => {
          resolve({ cancelled: true });
          cleanupListeners();
        };

        const cleanupListeners = () => {
          ipcMain.removeListener(
            IPC_CHANNELS.SELECTION_OVERLAY_COMPLETE,
            handleComplete
          );
          ipcMain.removeListener(
            IPC_CHANNELS.SELECTION_OVERLAY_CANCEL,
            handleCancel
          );
          this.hide();
        };

        ipcMain.once(IPC_CHANNELS.SELECTION_OVERLAY_COMPLETE, handleComplete);
        ipcMain.once(IPC_CHANNELS.SELECTION_OVERLAY_CANCEL, handleCancel);
      }
    );

    for (const target of targets) {
      const win = new BrowserWindow({
        x: target.x,
        y: target.y,
        width: target.width,
        height: target.height,
        frame: false,
        transparent: true,
        skipTaskbar: true,
        resizable: false,
        show: false,
        alwaysOnTop: true,
        focusable: true,
        fullscreenable: false,
        hasShadow: false,
        webPreferences: {
          preload: join(__dirname, "../../preload.js"),
          contextIsolation: true,
          nodeIntegration: false,
        },
      });

      win.on("closed", () => {
        this.windows = this.windows.filter((w) => w !== win);
      });

      this.windows.push(win);
      if (this.isDev) {
        await win.loadURL(
          `http://localhost:3000/selection-overlay.html?displayId=${encodeURIComponent(
            target.displayId
          )}`
        );
      } else {
        await win.loadFile(
          join(
            process.resourcesPath,
            "app.asar.unpacked/src/ui/dist/selection-overlay.html"
          ),
          { query: { displayId: target.displayId } }
        );
      }
      win.showInactive();
    }

    // Focus the first overlay to ensure key events (ESC) are captured
    this.windows[0]?.focus();

    const result = await selectionPromise;
    return result;
  }

  hide() {
    this.windows.forEach((win) => {
      if (!win.isDestroyed()) win.destroy();
    });
    this.windows = [];
  }

  async showHighlight(region: SelectionRegion): Promise<void> {
    this.hideHighlight();

    const target = this.getDisplayBounds(region.displayId);
    const urlQuery = `displayId=${encodeURIComponent(
      target.displayId
    )}&mode=highlight&x=${region.x}&y=${region.y}&width=${
      region.width
    }&height=${region.height}`;

    this.highlightWindow = new BrowserWindow({
      x: target.x,
      y: target.y,
      width: target.width,
      height: target.height,
      frame: false,
      transparent: true,
      skipTaskbar: true,
      resizable: false,
      show: false,
      alwaysOnTop: true,
      focusable: false,
      fullscreenable: false,
      hasShadow: false,
      webPreferences: {
        preload: join(__dirname, "../../preload.js"),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    this.highlightWindow.setIgnoreMouseEvents(true);

    if (this.isDev) {
      await this.highlightWindow.loadURL(
        `http://localhost:3000/selection-overlay.html?${urlQuery}`
      );
    } else {
      await this.highlightWindow.loadFile(
        join(
          process.resourcesPath,
          "app.asar.unpacked/src/ui/dist/selection-overlay.html"
        ),
        {
          query: {
            displayId: target.displayId,
            mode: "highlight",
            x: region.x.toString(),
            y: region.y.toString(),
            width: region.width.toString(),
            height: region.height.toString(),
          },
        }
      );
    }

    this.highlightWindow.showInactive();
  }

  hideHighlight() {
    if (this.highlightWindow && !this.highlightWindow.isDestroyed()) {
      this.highlightWindow.destroy();
    }
    this.highlightWindow = null;
  }

  private getDisplayBounds(displayId?: string) {
    const displays = screen.getAllDisplays();
    const display = displayId
      ? displays.find(
          (d) => d.id.toString() === displayId || d.id === Number(displayId)
        ) ?? screen.getPrimaryDisplay()
      : screen.getPrimaryDisplay();

    const { x, y, width, height } = display.bounds;
    return { x, y, width, height, displayId: display.id.toString() };
  }
}
