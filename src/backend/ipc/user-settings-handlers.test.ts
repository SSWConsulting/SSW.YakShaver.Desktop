import { ipcMain } from "electron";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HotkeyManager } from "../services/settings/hotkey-manager";
import { UserSettingsStorage } from "../services/storage/user-settings-storage";
import type { TrayManager } from "../services/tray/tray-manager";
import { IPC_CHANNELS } from "./channels";
import { UserSettingsIPCHandlers } from "./user-settings-handlers";

// Mock dependencies
vi.mock("electron", () => ({
  app: {
    setLoginItemSettings: vi.fn(),
  },
  ipcMain: {
    handle: vi.fn(),
  },
  BrowserWindow: {
    getAllWindows: vi.fn().mockReturnValue([]),
  },
}));

vi.mock("../services/settings/hotkey-manager");
vi.mock("../services/storage/user-settings-storage");
vi.mock("../services/tray/tray-manager");

describe("UserSettingsIPCHandlers", () => {
  let _handlers: UserSettingsIPCHandlers;
  let mockTrayManager: TrayManager;
  let mockStorage: Partial<UserSettingsStorage>;
  let mockHotkeyManager: Partial<HotkeyManager>;

  beforeEach(() => {
    vi.clearAllMocks();

    mockStorage = {
      getSettingsAsync: vi.fn().mockResolvedValue({
        openAtLogin: false,
        hotkeys: { startRecording: "Ctrl+Shift+R" },
      }),
      updateSettingsAsync: vi.fn().mockResolvedValue(undefined),
    };
    // @ts-expect-error - mock implementations
    UserSettingsStorage.getInstance.mockReturnValue(mockStorage);

    mockHotkeyManager = {
      registerHotkeys: vi.fn().mockReturnValue({ success: true }),
    };
    // @ts-expect-error - mock implementations
    HotkeyManager.getInstance.mockReturnValue(mockHotkeyManager);

    mockTrayManager = {
      setRecordHotkey: vi.fn(),
    } as unknown as TrayManager;

    _handlers = new UserSettingsIPCHandlers(mockTrayManager);
  });

  it("should register IPC handlers on instantiation", () => {
    expect(ipcMain.handle).toHaveBeenCalledWith(IPC_CHANNELS.SETTINGS_GET, expect.any(Function));
    expect(ipcMain.handle).toHaveBeenCalledWith(IPC_CHANNELS.SETTINGS_UPDATE, expect.any(Function));
  });

  it("should sync hotkeys to tray on startup", async () => {
    // Wait for async constructor tasks
    await new Promise(process.nextTick);

    expect(mockTrayManager.setRecordHotkey).toHaveBeenCalledWith("Ctrl+Shift+R");
  });

  it("should register global hotkeys on startup", async () => {
    // Wait for async constructor tasks
    await new Promise(process.nextTick);

    expect(mockHotkeyManager.registerHotkeys).toHaveBeenCalledWith({
      startRecording: "Ctrl+Shift+R",
    });
  });
});
