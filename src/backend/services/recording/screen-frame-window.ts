import { join } from "node:path";
import { BrowserWindow, desktopCapturer, screen } from "electron";

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

  async show(displayId?: string): Promise<void> {
    if (this.window) {
      this.window.destroy();
    }

    const sources = await desktopCapturer.getSources({
      types: ["screen", "window"],
    });

    const selected =
      sources.find((s) => s.id === displayId) || sources.find((s) => s.display_id) || sources[0];

    const { x, y, width, height, } = this.getDisplayBounds(selected.display_id);
    const url = this.isDev
      ? "http://localhost:3000/frame-overlay.html"
      : join(process.resourcesPath, "app.asar.unpacked/src/ui/dist/frame-overlay.html");

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
      // NOTE: on windows it behaves correct but on MacOS it will create a new space/screen which is undesired
      fullscreen: false,
      alwaysOnTop: true,
      webPreferences: {
        preload: join(__dirname, "../../preload.js"),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    // NOTE: there is a bug where the above code doesn't set the correct size and it always ends up
    //       with the size of the primary display, even if a different display is selected.
    //       Manually setting the size again seems to fix it, but it's unclear why this is happening.
    this.window.setSize(width, height);

    this.window.on("closed", () => {
      this.window = null;
    });

    this.window.setAlwaysOnTop(true, "screen-saver");
    this.window.setIgnoreMouseEvents(true);

    this.isDev ? this.window.loadURL(url) : this.window.loadFile(url);

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

    // NOTE: on MacOS the taskbar is included in the bounds returned by screen.getAllDisplays()
    //       but on Windows it is not, so we need to use workArea which excludes the taskbar
    //       to ensure the frame is not hidden behind the taskbar on Windows.
    //       Either we return bounds for windows and workarea for macOS or
    //       we can just always return workArea which seems to work correctly on both platforms.
    //
    //       Another observation we had on macOS was that even when using bounds, on one screen it
    //       would return the correct size but on a second screen it would return a smaller size
    //       and offset by the taskbar size which caused the frame to be in the wrong position
    //       and be cut off at the bottom. Might need some more testing on macOS
    return display.workArea;
  }
}
