import type { BrowserWindow } from "electron";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TrayManager } from "./tray-manager";

const { mockTray, mockAppQuit } = vi.hoisted(() => ({
  mockTray: {
    setToolTip: vi.fn(),
    setContextMenu: vi.fn(),
    on: vi.fn(),
    destroy: vi.fn(),
  },
  mockAppQuit: vi.fn(),
}));

vi.mock("electron", () => {
  return {
    app: {
      quit: mockAppQuit,
    },
    Tray: class MockTray {
      setToolTip = mockTray.setToolTip;
      setContextMenu = mockTray.setContextMenu;
      on = mockTray.on;
      destroy = mockTray.destroy;
    },
    Menu: {
      buildFromTemplate: vi.fn().mockImplementation((template) => template),
    },
    nativeImage: {
      createFromPath: vi.fn().mockReturnValue({
        resize: vi.fn().mockReturnValue({}),
      }),
    },
  };
});

vi.mock("../../utils/path-utils", () => ({
  getIconPath: vi.fn().mockReturnValue("/mock/path/icon.png"),
}));

describe("TrayManager", () => {
  let trayManager: TrayManager;
  let mockQuitHandler: () => void;

  beforeEach(() => {
    vi.clearAllMocks();
    mockQuitHandler = vi.fn<() => void>();
    trayManager = new TrayManager(mockQuitHandler);
  });

  describe("constructor", () => {
    it("should create tray manager with dependencies", () => {
      expect(trayManager).toBeDefined();
    });
  });

  describe("createTray", () => {
    it("should create tray with icon and tooltip", () => {
      trayManager.createTray();

      expect(mockTray.setToolTip).toHaveBeenCalledWith("YakShaver");
    });

    it("should register click handler on tray", () => {
      trayManager.createTray();

      expect(mockTray.on).toHaveBeenCalledWith("click", expect.any(Function));
    });
  });

  describe("setMainWindow", () => {
    it("should set the main window reference", () => {
      const mockWindow = {} as BrowserWindow;
      expect(() => trayManager.setMainWindow(mockWindow)).not.toThrow();
    });
  });

  describe("setRecordHotkey", () => {
    it("should update tray menu with new hotkey", () => {
      trayManager.createTray();
      trayManager.setRecordHotkey("Ctrl+Shift+R");

      expect(mockTray.setContextMenu).toHaveBeenCalledTimes(2); // Once on create, once on update
    });
  });

  describe("updateTrayMenu", () => {
    it("should update context menu when tray exists", () => {
      trayManager.createTray();

      expect(mockTray.setContextMenu).toHaveBeenCalled();
    });

    it("should not throw if tray not created", () => {
      expect(() => trayManager.updateTrayMenu()).not.toThrow();
    });
  });

  describe("destroy", () => {
    it("should destroy tray when it exists", () => {
      trayManager.createTray();
      trayManager.destroy();

      expect(mockTray.destroy).toHaveBeenCalled();
    });

    it("should not throw if tray does not exist", () => {
      expect(() => trayManager.destroy()).not.toThrow();
    });

    it("should not throw when called twice", () => {
      trayManager.createTray();
      trayManager.destroy();
      expect(() => trayManager.destroy()).not.toThrow();
    });
  });

  describe("tray click event", () => {
    it("should show and focus window when tray is clicked", () => {
      const mockWindow = {
        show: vi.fn(),
        isMinimized: vi.fn().mockReturnValue(false),
        restore: vi.fn(),
        focus: vi.fn(),
        webContents: { send: vi.fn() },
      } as unknown as BrowserWindow;

      trayManager.setMainWindow(mockWindow);
      trayManager.createTray();

      // Get the click handler that was registered
      const clickHandler = mockTray.on.mock.calls.find(
        (call) => call[0] === "click",
      )?.[1] as () => void;
      clickHandler();

      expect(mockWindow.show).toHaveBeenCalled();
      expect(mockWindow.focus).toHaveBeenCalled();
    });

    it("should restore window if minimized when tray is clicked", () => {
      const mockWindow = {
        show: vi.fn(),
        isMinimized: vi.fn().mockReturnValue(true),
        restore: vi.fn(),
        focus: vi.fn(),
        webContents: { send: vi.fn() },
      } as unknown as BrowserWindow;

      trayManager.setMainWindow(mockWindow);
      trayManager.createTray();

      const clickHandler = mockTray.on.mock.calls.find(
        (call) => call[0] === "click",
      )?.[1] as () => void;
      clickHandler();

      expect(mockWindow.restore).toHaveBeenCalled();
    });
  });

  describe("tray menu actions", () => {
    it("should show window when Open YakShaver menu item is clicked", () => {
      const mockWindow = {
        show: vi.fn(),
        isMinimized: vi.fn().mockReturnValue(false),
        restore: vi.fn(),
        focus: vi.fn(),
        webContents: { send: vi.fn() },
      } as unknown as BrowserWindow;

      trayManager.setMainWindow(mockWindow);
      trayManager.createTray();

      // Get the menu template from setContextMenu call
      const menuTemplate = mockTray.setContextMenu.mock.calls[0][0] as Array<{
        label?: string;
        click?: () => void;
      }>;
      const openItem = menuTemplate.find((item) => item.label === "Open YakShaver");
      openItem?.click?.();

      expect(mockWindow.show).toHaveBeenCalled();
      expect(mockWindow.focus).toHaveBeenCalled();
    });

    it("should call quit handler and app.quit when Quit menu item is clicked", () => {
      trayManager.createTray();

      const menuTemplate = mockTray.setContextMenu.mock.calls[0][0] as Array<{
        label?: string;
        click?: () => void;
      }>;
      const quitItem = menuTemplate.find((item) => item.label === "Quit YakShaver");
      quitItem?.click?.();

      expect(mockQuitHandler).toHaveBeenCalled();
      expect(mockAppQuit).toHaveBeenCalled();
    });

    it("should open source picker when Record Shave menu item is clicked", () => {
      const mockWindow = {
        show: vi.fn(),
        isMinimized: vi.fn().mockReturnValue(false),
        restore: vi.fn(),
        focus: vi.fn(),
        webContents: { send: vi.fn() },
      } as unknown as BrowserWindow;

      trayManager.setMainWindow(mockWindow);
      trayManager.createTray();

      const menuTemplate = mockTray.setContextMenu.mock.calls[0][0] as Array<{
        label?: string;
        click?: () => void;
      }>;
      const recordItem = menuTemplate.find((item) => item.label === "Record Shave");
      recordItem?.click?.();

      expect(mockWindow.show).toHaveBeenCalled();
      expect(mockWindow.webContents.send).toHaveBeenCalledWith("open-source-picker");
    });

    it("should not throw when Record Shave clicked without main window", () => {
      trayManager.createTray();

      const menuTemplate = mockTray.setContextMenu.mock.calls[0][0] as Array<{
        label?: string;
        click?: () => void;
      }>;
      const recordItem = menuTemplate.find((item) => item.label === "Record Shave");

      expect(() => recordItem?.click?.()).not.toThrow();
    });
  });
});
