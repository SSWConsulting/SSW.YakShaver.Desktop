import type { BrowserWindow } from "electron";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { IPC_CHANNELS } from "../../ipc/channels";
import { HotkeyManager } from "./hotkey-manager";

// Mock Electron globalShortcut
const mockGlobalShortcut = {
  register: vi.fn(),
  unregisterAll: vi.fn(),
  isRegistered: vi.fn(),
};

vi.mock("electron", () => ({
  globalShortcut: {
    register: (key: string, callback: () => void) => mockGlobalShortcut.register(key, callback),
    unregisterAll: () => mockGlobalShortcut.unregisterAll(),
    isRegistered: (key: string) => mockGlobalShortcut.isRegistered(key),
  },
}));

describe("HotkeyManager", () => {
  let hotkeyManager: HotkeyManager;

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset singleton
    // @ts-expect-error - accessing private property for test isolation
    HotkeyManager.instance = null;
    hotkeyManager = HotkeyManager.getInstance();
  });

  describe("getInstance", () => {
    it("should return the same instance", () => {
      const instance1 = HotkeyManager.getInstance();
      const instance2 = HotkeyManager.getInstance();
      expect(instance1).toBe(instance2);
    });
  });

  describe("registerHotkey", () => {
    it("should register a valid hotkey", () => {
      mockGlobalShortcut.register.mockReturnValue(true);

      const result = hotkeyManager.registerHotkey("startRecording", "Ctrl+Shift+R");

      expect(result.success).toBe(true);
      expect(mockGlobalShortcut.register).toHaveBeenCalledWith(
        "Ctrl+Shift+R",
        expect.any(Function),
      );
    });

    it("should fail if globalShortcut.register returns false", () => {
      mockGlobalShortcut.register.mockReturnValue(false);

      const result = hotkeyManager.registerHotkey("startRecording", "Ctrl+Shift+R");

      expect(result.success).toBe(false);
      expect(result.error).toContain("already in use");
    });

    it("should return success if keybind is null/empty", () => {
      const result = hotkeyManager.registerHotkey("startRecording", null);
      expect(result.success).toBe(true);
      expect(mockGlobalShortcut.register).not.toHaveBeenCalled();
    });

    it("should return error for unknown action", () => {
      // @ts-expect-error - testing invalid input
      const result = hotkeyManager.registerHotkey("unknown", "Ctrl+X");
      expect(result.success).toBe(false);
      expect(result.error).toContain("No handler found");
    });
  });

  describe("registerHotkeys", () => {
    it("should unregister all previous hotkeys before registering new ones", () => {
      mockGlobalShortcut.register.mockReturnValue(true);
      hotkeyManager.registerHotkeys({ startRecording: "Ctrl+1" });

      expect(mockGlobalShortcut.unregisterAll).toHaveBeenCalled();
    });

    it("should return failed actions if registration fails", () => {
      mockGlobalShortcut.register.mockReturnValue(false);

      const result = hotkeyManager.registerHotkeys({ startRecording: "Ctrl+1" });

      expect(result.success).toBe(false);
      expect(result.failedActions).toHaveLength(1);
      expect(result.failedActions?.[0].keybind).toBe("Ctrl+1");
    });
  });

  describe("handleStartRecording", () => {
    it("should restore and show main window and send IPC message", () => {
      const mockWebContents = { send: vi.fn() };
      const mockWindow = {
        isMinimized: vi.fn().mockReturnValue(true),
        restore: vi.fn(),
        show: vi.fn(),
        focus: vi.fn(),
        webContents: mockWebContents,
      } as unknown as BrowserWindow;

      hotkeyManager.setMainWindow(mockWindow);

      // Access private handler to test logic
      // @ts-expect-error - accessing private property
      hotkeyManager.handleStartRecording();

      expect(mockWindow.restore).toHaveBeenCalled();
      expect(mockWindow.show).toHaveBeenCalled();
      expect(mockWindow.focus).toHaveBeenCalled();
      expect(mockWebContents.send).toHaveBeenCalledWith(IPC_CHANNELS.OPEN_SOURCE_PICKER);
    });

    it("should not crash if main window is not set", () => {
      // @ts-expect-error - accessing private property
      expect(() => hotkeyManager.handleStartRecording()).not.toThrow();
    });
  });
});
