import { join } from "node:path";
import { config as dotenvConfig } from "dotenv";
import { app, BrowserWindow, dialog, Menu, session, shell } from "electron";
import { autoUpdater } from "electron-updater";
import tmp from "tmp";
import { config } from "./config/env";
import { initDatabase } from "./db";
import { registerEventForwarders } from "./events/event-forwarder";
import { AppControlIPCHandlers } from "./ipc/app-control-handlers";
import { AuthIPCHandlers } from "./ipc/auth-handlers";
import { CustomPromptSettingsIPCHandlers } from "./ipc/custom-prompt-settings-handlers";
import { GitHubTokenIPCHandlers } from "./ipc/github-token-handlers";
import { KeyboardShortcutIPCHandlers } from "./ipc/keyboard-shortcut-handlers";
import { LLMSettingsIPCHandlers } from "./ipc/llm-settings-handlers";
import { McpIPCHandlers } from "./ipc/mcp-handlers";
import { MicrosoftAuthIPCHandlers } from "./ipc/microsoft-auth-handlers";
import { registerPortalHandlers } from "./ipc/portal-handlers";
import { ProcessVideoIPCHandlers } from "./ipc/process-video-handlers";
import { ReleaseChannelIPCHandlers } from "./ipc/release-channel-handlers";
import { ScreenRecordingIPCHandlers } from "./ipc/screen-recording-handlers";
import { ShaveIPCHandlers } from "./ipc/shave-handlers";
import { ToolApprovalSettingsIPCHandlers } from "./ipc/tool-approval-settings-handlers";
import { MicrosoftAuthService } from "./services/auth/microsoft-auth";
import { registerAllInternalMcpServers } from "./services/mcp/internal/register-internal-servers";
import { MCPOrchestrator } from "./services/mcp/mcp-orchestrator";
import { MCPServerManager } from "./services/mcp/mcp-server-manager";
import { CameraWindow } from "./services/recording/camera-window";
import { RecordingControlBarWindow } from "./services/recording/control-bar-window";
import { CountdownWindow } from "./services/recording/countdown-window";
import { RecordingService } from "./services/recording/recording-service";
import { ShortcutManager } from "./services/shortcut-manager";
import { KeyboardShortcutStorage } from "./services/storage/keyboard-shortcut-storage";
import { TrayManager } from "./services/tray-manager";

const isDev = process.env.NODE_ENV === "development";

// Set a custom userData directory in development to avoid conflicts with production
if (isDev) {
  const devUserData = join(app.getPath("appData"), "YakShaverDev");
  app.setPath("userData", devUserData);
}

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
let pendingProtocolUrl: string | null = null;
let isQuitting = false;

// Initialize managers
const shortcutManager = new ShortcutManager();
const trayManager = new TrayManager(
  isDev,
  () => {
    isQuitting = true;
  },
  () => {
    shortcutManager.handleShortcutTrigger();
  },
);

const getAppVersion = (): string => app.getVersion();

const version = getAppVersion();
const commitHash = config.commitHash();
const appTitle = `YakShaver`;

const createMenu = (): Menu => {
  const hashString = commitHash ? `${commitHash}` : "N/A";
  const template: Electron.MenuItemConstructorOptions[] = [];

  // Add app menu for macOS
  if (process.platform === "darwin") {
    template.push({
      role: "appMenu",
    });
  }

  template.push(
    {
      label: "File",
      submenu: [
        {
          label: "Quit",
          accelerator: "CmdOrCtrl+Q",
          click: () => {
            app.quit();
          },
        },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
      ],
    },
  );

  if (process.platform !== "darwin") {
    template.push({
      label: "Help",
      submenu: [
        {
          label: "About YakShaver",
          click: () => {
            dialog.showMessageBox({
              type: "info",
              title: "About YakShaver",
              message: `${appTitle}`,
              detail: `Version: ${version}
Commit: ${hashString}`,
              buttons: ["OK"],
            });
          },
        },
      ],
    });
  }

  // Add DevTools in development
  if (isDev) {
    const viewMenu = template.find((item) => item.label === "View");
    if (viewMenu && Array.isArray(viewMenu.submenu)) {
      viewMenu.submenu.push({ type: "separator" }, { role: "toggleDevTools" });
    }
  }

  return Menu.buildFromTemplate(template);
};

const createApplicationMenu = (): void => {
  const menu = createMenu();
  Menu.setApplicationMenu(menu);
};

const createWindow = (): void => {
  // Fix icon path for packaged mode
  const iconPath = isDev
    ? join(__dirname, "../../src/ui/public/icons/icon.png")
    : join(process.resourcesPath, "public/icons/icon.png");

  const title = `YakShaver`;

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    title,
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

  // Minimize to tray instead of closing
  mainWindow.on("close", (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow?.hide();
      return false;
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
    // Cleanup any pending MCP tool approvals to prevent hanging promises
    MCPOrchestrator.getInstanceAsync().then((orchestrator) => {
      orchestrator.cancelAllPendingApprovals("Window closed");
    });
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

// Helper to safely send protocol URL to renderer
const sendProtocolUrlToRenderer = (window: BrowserWindow, url: string): void => {
  if (window.webContents.isLoading()) {
    // Queue until content finishes loading
    window.webContents.once("did-finish-load", () => {
      window.webContents.send("protocol-url", url);
    });
  } else {
    // Send immediately if already loaded
    window.webContents.send("protocol-url", url);
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
let _toolApprovalSettingsHandlers: ToolApprovalSettingsIPCHandlers;
let _shaveHandlers: ShaveIPCHandlers;
let _appControlHandlers: AppControlIPCHandlers;
let _keyboardShortcutHandlers: KeyboardShortcutIPCHandlers;
let unregisterEventForwarders: (() => void) | undefined;

// Update auto-launch setting
const updateAutoLaunch = (enabled: boolean): void => {
  app.setLoginItemSettings({
    openAtLogin: enabled,
    openAsHidden: true,
  });
};

// Register protocol handler
const azure = config.azure();
if (azure?.customProtocol) {
  try {
    if (isDev) {
      // In dev mode, need to provide the electron executable and app path
      app.setAsDefaultProtocolClient(azure.customProtocol, process.execPath, [app.getAppPath()]);
    } else {
      // In production, the app itself is the executable
      app.setAsDefaultProtocolClient(azure.customProtocol);
    }
  } catch (err) {
    console.error("Failed to set default protocol client:", err);
  }
}

// Single instance lock - prevents multiple instances of the app
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  // Another instance is already running, exit immediately
  process.exit(0);
} else {
  // Handle second instance attempts - focus the existing window
  app.on("second-instance", (_event, commandLine) => {
    // Someone tried to run a second instance, focus our window instead
    if (mainWindow) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      }
      mainWindow.focus();

      // Check for protocol URL in command line (Windows)
      const url = commandLine.find((arg) => arg.startsWith(`${azure?.customProtocol}://`));
      if (url) {
        sendProtocolUrlToRenderer(mainWindow, url);
      }
    } else {
      // Store for later if window not ready yet
      const url = commandLine.find((arg) => arg.startsWith(`${azure?.customProtocol}://`));
      if (url) {
        pendingProtocolUrl = url;
      }
    }
  });

  // Handle protocol URLs on macOS
  app.on("open-url", (event, url) => {
    event.preventDefault();
    if (mainWindow) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      }
      mainWindow.focus();
      sendProtocolUrlToRenderer(mainWindow, url);
    } else {
      // Store for later if window not ready yet
      pendingProtocolUrl = url;
    }
  });
}

app.setAboutPanelOptions({
  applicationName: appTitle,
  applicationVersion: version,
  version: version,
});

app.whenReady().then(async () => {
  // Initialize database on startup with automatic backup and rollback
  try {
    await initDatabase();
  } catch (error) {
    console.error("Failed to initialize database:", error);

    // Show error dialog to user
    dialog.showErrorBox(
      "Database Initialization Failed",
      `Failed to initialize the database. The app will continue but data may not be saved.\n\nError: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  session.defaultSession.setPermissionCheckHandler(() => true);
  session.defaultSession.setPermissionRequestHandler((_, permission, callback) => {
    callback(
      ["media", "clipboard-read", "clipboard-sanitized-write", "fullscreen"].includes(permission),
    );
  });

  _authHandlers = new AuthIPCHandlers();
  const microsoftAuthService = MicrosoftAuthService.getInstance();
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
  _appControlHandlers = new AppControlIPCHandlers();
  _releaseChannelHandlers = new ReleaseChannelIPCHandlers();
  _githubTokenHandlers = new GitHubTokenIPCHandlers();
  _toolApprovalSettingsHandlers = new ToolApprovalSettingsIPCHandlers();
  _shaveHandlers = new ShaveIPCHandlers();

  // Initialize keyboard shortcut handlers with callbacks
  _keyboardShortcutHandlers = new KeyboardShortcutIPCHandlers(
    (shortcut: string) => {
      const success = shortcutManager.registerShortcut(shortcut);
      if (success) {
        trayManager.updateTrayMenu(shortcut);
      }
      return success;
    },
    (enabled: boolean) => {
      updateAutoLaunch(enabled);
    },
  );

  // Load and apply keyboard shortcut settings
  const keyboardShortcutStorage = KeyboardShortcutStorage.getInstance();
  const shortcutSettings = await keyboardShortcutStorage.getSettings();
  shortcutManager.registerShortcut(shortcutSettings.recordShortcut);
  updateAutoLaunch(shortcutSettings.autoLaunchEnabled);

  // Set main window references for managers
  shortcutManager.setMainWindow(mainWindow);
  trayManager.setMainWindow(mainWindow);

  // Pre-initialize recording windows for faster display
  RecordingControlBarWindow.getInstance().initialize(isDev);
  CameraWindow.getInstance().initialize(isDev);
  CountdownWindow.getInstance().initialize(isDev);
  unregisterEventForwarders = registerEventForwarders();

  // Create application menu
  createApplicationMenu();

  // Create tray icon
  trayManager.createTray();

  createWindow();

  // Process any pending protocol URL that arrived during initialization
  if (pendingProtocolUrl && mainWindow) {
    sendProtocolUrlToRenderer(mainWindow, pendingProtocolUrl);
    pendingProtocolUrl = null;
  }

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

const cleanup = async () => {
  if (isQuitting) return;
  isQuitting = true;

  // Unregister global shortcuts
  shortcutManager.unregisterAll();

  // Destroy tray icon
  trayManager.destroy();

  unregisterEventForwarders?.();
  try {
    await RecordingService.getInstance().cleanupAllTempFiles();
  } catch (err) {
    console.error("Cleanup error:", err);
  }
};

app.on("window-all-closed", async () => {
  // Keep app running in tray when all windows are closed
  // The app will only fully quit when user selects "Quit" from tray menu
});

app.on("before-quit", async (event) => {
  if (!isQuitting) {
    event.preventDefault();
    await cleanup();
    // isQuitting is now true, so next quit will not be prevented
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

export function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}
