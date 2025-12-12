import { join } from "node:path";
import { config as dotenvConfig } from "dotenv";
import { app, BrowserWindow, session, shell } from "electron";
import { autoUpdater } from "electron-updater";
import tmp from "tmp";
import { config } from "./config/env";
import { registerEventForwarders } from "./events/event-forwarder";
import { AuthIPCHandlers } from "./ipc/auth-handlers";
import { CustomPromptSettingsIPCHandlers } from "./ipc/custom-prompt-settings-handlers";
import { GeneralSettingsIPCHandlers } from "./ipc/general-settings-handlers";
import { GitHubTokenIPCHandlers } from "./ipc/github-token-handlers";
import { LLMSettingsIPCHandlers } from "./ipc/llm-settings-handlers";
import { McpIPCHandlers } from "./ipc/mcp-handlers";
import { MicrosoftAuthIPCHandlers } from "./ipc/microsoft-auth-handlers";
import { registerPortalHandlers } from "./ipc/portal-handlers";
import { ProcessVideoIPCHandlers } from "./ipc/process-video-handlers";
import { ReleaseChannelIPCHandlers } from "./ipc/release-channel-handlers";
import { ScreenRecordingIPCHandlers } from "./ipc/screen-recording-handlers";
import { MicrosoftAuthService } from "./services/auth/microsoft-auth";
import { registerAllInternalMcpServers } from "./services/mcp/internal/register-internal-servers";
import { MCPServerManager } from "./services/mcp/mcp-server-manager";
import { CameraWindow } from "./services/recording/camera-window";
import { RecordingControlBarWindow } from "./services/recording/control-bar-window";
import { CountdownWindow } from "./services/recording/countdown-window";
import { RecordingService } from "./services/recording/recording-service";

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

const createWindow = (): void => {
  // Fix icon path for packaged mode
  const iconPath = isDev
    ? join(__dirname, "../ui/public/icons/icon.png")
    : join(process.resourcesPath, "public/icons/icon.png");

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    icon: iconPath,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: join(__dirname, "preload.js"),
    },
  });

  // URLs - by default, open in default browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http://") || url.startsWith("https://")) {
      shell.openExternal(url);
      return { action: "deny" };
    }
    return { action: "allow" };
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
  });

  if (isDev) {
    mainWindow.loadURL("http://localhost:3000");
    mainWindow.webContents.openDevTools();
  } else {
    const indexPath = join(process.resourcesPath, "app.asar.unpacked/src/ui/dist/index.html");
    mainWindow.loadFile(indexPath).catch((err) => {
      console.error("Failed to load index.html:", err);
    });
  }
};

// Initialize IPC handlers
let _screenRecordingHandlers: ScreenRecordingIPCHandlers;
let _authHandlers: AuthIPCHandlers;
let _msAuthHandlers: MicrosoftAuthIPCHandlers;
let _llmSettingsHandlers: LLMSettingsIPCHandlers;
let _mcpHandlers: McpIPCHandlers;
let _customPromptSettingsHandlers: CustomPromptSettingsIPCHandlers;
let _processVideoHandlers: ProcessVideoIPCHandlers;
let _releaseChannelHandlers: ReleaseChannelIPCHandlers;
let _githubTokenHandlers: GitHubTokenIPCHandlers;
let _generalSettingsHandlers: GeneralSettingsIPCHandlers;
let unregisterEventForwarders: (() => void) | undefined;

app.whenReady().then(async () => {
  const azure = config.azure();
  if (azure?.customProtocol) {
    try {
      app.setAsDefaultProtocolClient(azure.customProtocol);
    } catch {}
    app.on("open-url", (event) => {
      event.preventDefault();
      mainWindow?.focus();
    });
  }
  session.defaultSession.setPermissionCheckHandler(() => true);
  session.defaultSession.setPermissionRequestHandler((_, permission, callback) => {
    callback(
      ["media", "clipboard-read", "clipboard-sanitized-write", "fullscreen"].includes(permission),
    );
  });

  _authHandlers = new AuthIPCHandlers();
  if (!azure) throw new Error("Azure configuration missing");
  const microsoftAuthService = new MicrosoftAuthService(azure);
  _msAuthHandlers = new MicrosoftAuthIPCHandlers(microsoftAuthService);
  _processVideoHandlers = new ProcessVideoIPCHandlers();
  registerPortalHandlers(microsoftAuthService);

  try {
    _llmSettingsHandlers = new LLMSettingsIPCHandlers();
  } catch (err) {
    console.error("Error creating LLMSettingsIPCHandlers:", err);
  }

  _screenRecordingHandlers = new ScreenRecordingIPCHandlers();

  // Initialize in-memory MCP servers
  await registerAllInternalMcpServers();

  const mcpServerManager = await MCPServerManager.getInstanceAsync();
  _mcpHandlers = new McpIPCHandlers(mcpServerManager);
  _customPromptSettingsHandlers = new CustomPromptSettingsIPCHandlers();
  _releaseChannelHandlers = new ReleaseChannelIPCHandlers();
  _githubTokenHandlers = new GitHubTokenIPCHandlers();
  _generalSettingsHandlers = new GeneralSettingsIPCHandlers();

  // Pre-initialize recording windows for faster display
  RecordingControlBarWindow.getInstance().initialize(isDev);
  CameraWindow.getInstance().initialize(isDev);
  CountdownWindow.getInstance().initialize(isDev);

  unregisterEventForwarders = registerEventForwarders();
  createWindow();

  // Auto-updates: Check only in packaged mode (dev skips)
  // Configure and check based on stored channel preference
  if (app.isPackaged) {
    const { ReleaseChannelStorage } = await import("./services/storage/release-channel-storage");
    const channelStore = ReleaseChannelStorage.getInstance();
    const channel = await channelStore.getChannel();
    _releaseChannelHandlers.configureAutoUpdater(channel, true);
    autoUpdater.checkForUpdatesAndNotify();
  }
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

export function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}
