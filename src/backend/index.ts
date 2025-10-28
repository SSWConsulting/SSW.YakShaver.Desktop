import { join } from "node:path";
import { config as dotenvConfig } from "dotenv";
import { app, BrowserWindow, nativeImage, session } from "electron";
import tmp from "tmp";
import { updateElectronApp } from "update-electron-app";
import { registerEventForwarders } from "./events/event-forwarder";
import { AuthIPCHandlers } from "./ipc/auth-handlers";
import { McpIPCHandlers } from "./ipc/mcp-handlers";
import { OpenAIIPCHandlers } from "./ipc/openai-handlers";
import { ScreenRecordingIPCHandlers } from "./ipc/screen-recording-handlers";
import { SettingsIPCHandlers } from "./ipc/settings-handlers";
import { VideoIPCHandlers } from "./ipc/video-handlers";
import { createMcpOrchestrator } from "./services/mcp/mcp-orchestrator-factory";
import { RecordingControlBarWindow } from "./services/recording/control-bar-window";
import { RecordingService } from "./services/recording/recording-service";

updateElectronApp();

const isDev = process.env.NODE_ENV === "development";

// Load .env early (before app.whenReady)
const loadEnv = () => {
  let envPath: string;
  if (app.isPackaged) {
    // Production: Load from bundled resources
    envPath = join(process.resourcesPath, ".env");
  } else {
    // Development: Load from project root
    envPath = join(process.cwd(), ".env");
  }
  dotenvConfig({ path: envPath });
};

loadEnv();

let mainWindow: BrowserWindow | null = null;

if (require("electron-squirrel-startup")) app.quit();

const createWindow = (): void => {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    icon: join(__dirname, "../ui/public/icons/icon.png"),
    show: false,

    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: join(__dirname, "preload.js"),
    },
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
  });

  if (isDev) {
    mainWindow.loadURL("http://localhost:3000");
    mainWindow.webContents.openDevTools();
  } else {
    const indexPath = join(
      process.resourcesPath,
      "app.asar.unpacked/src/ui/dist/index.html"
    );
    mainWindow.loadFile(indexPath).catch((err) => {
      console.error("Failed to load index.html:", err);
    });
  }
};

// Initialize IPC handlers
let _screenRecordingHandlers: ScreenRecordingIPCHandlers;
let _authHandlers: AuthIPCHandlers;
let _videoHandlers: VideoIPCHandlers;
let _openAIHandlers: OpenAIIPCHandlers;
let _mcpHandlers: McpIPCHandlers;
let _settingsHandlers: SettingsIPCHandlers;
let unregisterEventForwarders: (() => void) | undefined;

app.whenReady().then(async () => {
  session.defaultSession.setPermissionCheckHandler(() => true);
  session.defaultSession.setPermissionRequestHandler(
    (_, permission, callback) => {
      callback(
        [
          "media",
          "clipboard-read",
          "clipboard-sanitized-write",
          "fullscreen",
        ].includes(permission)
      );
    }
  );

  _authHandlers = new AuthIPCHandlers();
  _videoHandlers = new VideoIPCHandlers();

  try {
    _openAIHandlers = new OpenAIIPCHandlers();
  } catch (err) {
    console.error("Error creating OpenAIIPCHandlers:", err);
  }

  _screenRecordingHandlers = new ScreenRecordingIPCHandlers();

  // Create MCP orchestrator with factory to ensure initialization completes
  const mcpOrchestrator = await createMcpOrchestrator({ eagerCreate: true });
  _mcpHandlers = new McpIPCHandlers(mcpOrchestrator);
  _settingsHandlers = new SettingsIPCHandlers();

  // Pre-initialize control bar window for faster display
  RecordingControlBarWindow.getInstance().initialize(isDev);

  unregisterEventForwarders = registerEventForwarders();
  createWindow();
});

tmp.setGracefulCleanup();

let isQuitting = false;

const cleanup = async () => {
  if (isQuitting) return;
  isQuitting = true;

  unregisterEventForwarders?.();
  try {
    await RecordingService.getInstance().cleanupAllTempFiles();
  } catch (err) {
    console.error("Cleanup error:", err);
  }
};

app.on("window-all-closed", async () => {
  await cleanup();
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", async (event) => {
  if (!isQuitting) {
    event.preventDefault();
    await cleanup();
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
