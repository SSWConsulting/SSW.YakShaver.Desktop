import { type BrowserWindow, globalShortcut } from "electron";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ShortcutManager } from "./shortcut-manager";

vi.mock("electron", () => ({
  globalShortcut: {
    register: vi.fn(),
    unregister: vi.fn(),
    unregisterAll: vi.fn(),
    isRegistered: vi.fn(),
  },
}));

describe("ShortcutManager", () => {
  let shortcutManager: ShortcutManager;

  beforeEach(() => {
    vi.clearAllMocks();
    shortcutManager = new ShortcutManager();
  });

  describe("registerShortcut", () => {
    it("should register a new shortcut successfully", () => {
      vi.mocked(globalShortcut.isRegistered).mockReturnValue(false);
      vi.mocked(globalShortcut.register).mockReturnValue(true);

      const result = shortcutManager.registerShortcut("Ctrl+Shift+R");

      expect(result).toBe(true);
      expect(vi.mocked(globalShortcut.register)).toHaveBeenCalledWith(
        "Ctrl+Shift+R",
        expect.any(Function),
      );
      expect(shortcutManager.getCurrentShortcut()).toBe("Ctrl+Shift+R");
    });

    it("should return false when registration fails", () => {
      vi.mocked(globalShortcut.isRegistered).mockReturnValue(false);
      vi.mocked(globalShortcut.register).mockReturnValue(false);

      const result = shortcutManager.registerShortcut("Ctrl+Alt+Delete");

      expect(result).toBe(false);
      expect(shortcutManager.getCurrentShortcut()).toBe("PrintScreen");
    });

    it("should unregister existing shortcut if already registered", () => {
      vi.mocked(globalShortcut.isRegistered).mockReturnValue(true);
      vi.mocked(globalShortcut.register).mockReturnValue(true);

      shortcutManager.registerShortcut("F12");

      expect(vi.mocked(globalShortcut.unregister)).toHaveBeenCalledWith("F12");
      expect(vi.mocked(globalShortcut.register)).toHaveBeenCalled();
    });

    it("should unregister old shortcut after successful registration of new one", () => {
      vi.mocked(globalShortcut.isRegistered).mockImplementation(
        (shortcut) => shortcut === "PrintScreen",
      );
      vi.mocked(globalShortcut.register).mockReturnValue(true);

      shortcutManager.registerShortcut("Ctrl+F12");

      expect(vi.mocked(globalShortcut.unregister)).toHaveBeenCalledWith("PrintScreen");
    });

    it("should not unregister old shortcut if registration fails", () => {
      vi.mocked(globalShortcut.isRegistered).mockReturnValue(false);
      vi.mocked(globalShortcut.register).mockReturnValue(false);

      shortcutManager.registerShortcut("Ctrl+F12");

      expect(vi.mocked(globalShortcut.unregister)).not.toHaveBeenCalledWith("PrintScreen");
    });
  });

  describe("getCurrentShortcut", () => {
    it("should return default shortcut initially", () => {
      expect(shortcutManager.getCurrentShortcut()).toBe("PrintScreen");
    });

    it("should return updated shortcut after successful registration", () => {
      vi.mocked(globalShortcut.isRegistered).mockReturnValue(false);
      vi.mocked(globalShortcut.register).mockReturnValue(true);

      shortcutManager.registerShortcut("Ctrl+Shift+S");

      expect(shortcutManager.getCurrentShortcut()).toBe("Ctrl+Shift+S");
    });
  });

  describe("handleShortcutTrigger", () => {
    it("should show, restore and focus window when triggered", () => {
      const mockWindow = {
        show: vi.fn(),
        isMinimized: vi.fn().mockReturnValue(true),
        restore: vi.fn(),
        focus: vi.fn(),
        webContents: {
          send: vi.fn(),
        },
      } as unknown as BrowserWindow;

      shortcutManager.setMainWindow(mockWindow);
      shortcutManager.handleShortcutTrigger();

      expect(mockWindow.show).toHaveBeenCalled();
      expect(mockWindow.restore).toHaveBeenCalled();
      expect(mockWindow.focus).toHaveBeenCalled();
      expect(mockWindow.webContents.send).toHaveBeenCalledWith("open-source-picker");
    });

    it("should not call restore if window is not minimized", () => {
      const mockWindow = {
        show: vi.fn(),
        isMinimized: vi.fn().mockReturnValue(false),
        restore: vi.fn(),
        focus: vi.fn(),
        webContents: {
          send: vi.fn(),
        },
      } as unknown as BrowserWindow;

      shortcutManager.setMainWindow(mockWindow);
      shortcutManager.handleShortcutTrigger();

      expect(mockWindow.restore).not.toHaveBeenCalled();
    });

    it("should do nothing if no main window is set", () => {
      expect(() => shortcutManager.handleShortcutTrigger()).not.toThrow();
    });
  });

  describe("unregisterAll", () => {
    it("should call globalShortcut.unregisterAll", () => {
      shortcutManager.unregisterAll();

      expect(vi.mocked(globalShortcut.unregisterAll)).toHaveBeenCalled();
    });
  });
});
