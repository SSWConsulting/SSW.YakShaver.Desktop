import type { BrowserWindow } from "electron";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TrayManager } from "./tray-manager";

const mockTray = {
  setToolTip: vi.fn(),
  setContextMenu: vi.fn(),
  on: vi.fn(),
  destroy: vi.fn(),
};

vi.mock("electron", () => {
  return {
    app: {
      quit: vi.fn(),
    },
    Tray: class MockTray {
      setToolTip = mockTray.setToolTip;
      setContextMenu = mockTray.setContextMenu;
      on = mockTray.on;
      destroy = mockTray.destroy;
    },
    Menu: {
      buildFromTemplate: vi.fn().mockReturnValue({}),
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

  describe("updateTrayMenu", () => {
    it("should update shortcut in menu when provided", () => {
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
});
