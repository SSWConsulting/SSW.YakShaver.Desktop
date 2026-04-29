import { join } from "node:path";
import { BrowserWindow, screen } from "electron";
import { devServerOrigin } from "../../utils/dev-server";

export class CountdownWindow {
  private static instance: CountdownWindow;
  private window: BrowserWindow | null = null;
  private isDev = false;

  static getInstance() {
    CountdownWindow.instance ??= new CountdownWindow();
    return CountdownWindow.instance;
  }

  initialize(isDev: boolean): void {
    this.isDev = isDev;
  }

  async show(displayId?: string): Promise<void> {
    if (this.window) {
      this.window.destroy();
    }

    const { x, y, width, height } = this.getDisplayBounds(displayId);
    const url = this.isDev
      ? `${devServerOrigin()}/countdown.html`
      : join(process.resourcesPath, "app.asar.unpacked/src/ui/dist/countdown.html");

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
      // NOTE: on windows it behaves correctly but on MacOS it will create a new space/screen which is undesired
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

    await (this.isDev ? this.window.loadURL(url) : this.window.loadFile(url));

    this.window.showInactive();

    // Wait for countdown to finish (3 seconds + small buffer)
    await new Promise((resolve) => setTimeout(resolve, 3200));

    this.hide();
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
