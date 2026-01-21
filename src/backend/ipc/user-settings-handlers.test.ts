import { app, BrowserWindow, ipcMain } from "electron";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
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

  it("should sync hotkeys to tray on initialize", async () => {
    await _handlers.initialize();
    expect(mockTrayManager.setRecordHotkey).toHaveBeenCalledWith("Ctrl+Shift+R");
  });

  it("should register global hotkeys on initialize", async () => {
    await _handlers.initialize();

    expect(mockHotkeyManager.registerHotkeys).toHaveBeenCalledWith({
      startRecording: "Ctrl+Shift+R",
    });
  });

  describe("SETTINGS_UPDATE handler", () => {
    let updateHandler: (event: unknown, patch: unknown) => Promise<unknown>;

    beforeEach(() => {
      // Extract the registered handler
      const updateCall = (ipcMain.handle as Mock).mock.calls.find(
        (call) => call[0] === IPC_CHANNELS.SETTINGS_UPDATE,
      );
      if (!updateCall) {
        throw new Error("SETTINGS_UPDATE handler not registered");
      }
      updateHandler = updateCall[1];
    });

    it("should handle invalid settings patch", async () => {
      // safeParse will strip unknown keys, so to test failure we need an invalid VALUE for a KNOWN key
      const result = await updateHandler({}, { openAtLogin: "not-a-boolean" });
      expect(result).toMatchObject({ success: false, error: "Invalid settings data" });
      expect(mockStorage.updateSettingsAsync).not.toHaveBeenCalled();
    });

    it("should ignore unknown settings keys but process valid ones", async () => {
      const patch = {
        openAtLogin: true,
        extraUnknownField: "should-be-ignored",
      };

      const result = await updateHandler({}, patch);

      expect(result).toEqual({ success: true });
      // updateSettingsAsync should be called with only the valid fields
      expect(mockStorage.updateSettingsAsync).toHaveBeenCalledWith({ openAtLogin: true });
      expect(app.setLoginItemSettings).toHaveBeenCalledWith({
        openAtLogin: true,
        openAsHidden: false,
      });
    });

    it("should not persist changes if only unknown keys are provided", async () => {
      const patch = { extraUnknownField: "should-be-ignored" };

      const result = await updateHandler({}, patch);

      expect(result).toEqual({ success: true });
      // Zod's safeParse returns {} if all input keys are stripped.
      // The implementation calls updateSettingsAsync(validPatch).
      expect(mockStorage.updateSettingsAsync).toHaveBeenCalledWith({});
    });

    it("should handle valid non-hotkey update", async () => {
      const patch = { openAtLogin: true };
      const result = await updateHandler({}, patch);

      expect(result).toEqual({ success: true });
      expect(mockStorage.updateSettingsAsync).toHaveBeenCalledWith(patch);
      expect(app.setLoginItemSettings).toHaveBeenCalledWith({
        openAtLogin: true,
        openAsHidden: false,
      });
    });

    it("should handle hotkey update success", async () => {
      const patch = { hotkeys: { startRecording: "Ctrl+New" } };
      const result = await updateHandler({}, patch);

      expect(result).toEqual({ success: true });
      expect(mockHotkeyManager.registerHotkeys).toHaveBeenCalledWith(patch.hotkeys);
      expect(mockStorage.updateSettingsAsync).toHaveBeenCalledWith({ hotkeys: patch.hotkeys });
      expect(mockTrayManager.setRecordHotkey).toHaveBeenCalledWith("Ctrl+New");
    });

    it("should handle hotkey update failure", async () => {
      const patch = { hotkeys: { startRecording: "Invalid" } };
      (mockHotkeyManager.registerHotkeys as Mock).mockReturnValue({
        success: false,
        failedActions: [{ keybind: "Invalid", reason: "Bad combination" }],
      });

      const result = await updateHandler({}, patch);

      expect(result).toEqual({
        success: false,
        error: 'Failed to register "Invalid": Bad combination',
      });
      // Should revert to old hotkeys
      expect(mockHotkeyManager.registerHotkeys).toHaveBeenLastCalledWith({
        startRecording: "Ctrl+Shift+R",
      });
      expect(mockStorage.updateSettingsAsync).not.toHaveBeenCalled();
    });

    it("should handle mixed update where hotkey fails", async () => {
      const patch = {
        openAtLogin: true,
        hotkeys: { startRecording: "Invalid" },
      };
      (mockHotkeyManager.registerHotkeys as Mock).mockReturnValue({
        success: false,
        failedActions: [{ keybind: "Invalid", reason: "Failure" }],
      });

      const result = await updateHandler({}, patch);

      expect(result).toMatchObject({ success: false });
      // Other settings should NOT be updated if hotkey fails
      expect(app.setLoginItemSettings).not.toHaveBeenCalled();
      expect(mockStorage.updateSettingsAsync).not.toHaveBeenCalled();
    });

    it("should handle mixed update where hotkey succeeds", async () => {
      const patch = {
        openAtLogin: true,
        hotkeys: { startRecording: "Ctrl+Alt+S" },
      };

      const result = await updateHandler({}, patch);

      expect(result).toEqual({ success: true });
      // Hotkeys registered
      expect(mockHotkeyManager.registerHotkeys).toHaveBeenCalledWith(patch.hotkeys);
      // Settings updated
      expect(mockStorage.updateSettingsAsync).toHaveBeenCalledWith({ hotkeys: patch.hotkeys });
      expect(mockStorage.updateSettingsAsync).toHaveBeenCalledWith({ openAtLogin: true });

      expect(app.setLoginItemSettings).toHaveBeenCalledWith({
        openAtLogin: true,
        openAsHidden: false,
      });
    });

    it("should broadcast hotkey changes to windows", async () => {
      const mockWebContents = { send: vi.fn() };
      const mockWindow = { webContents: mockWebContents };
      (BrowserWindow.getAllWindows as Mock).mockReturnValue([mockWindow]);

      const patch = { hotkeys: { startRecording: "Ctrl+K" } };
      await updateHandler({}, patch);

      expect(mockWebContents.send).toHaveBeenCalledWith(
        IPC_CHANNELS.SETTINGS_HOTKEY_UPDATE,
        patch.hotkeys,
      );
    });
  });
});
