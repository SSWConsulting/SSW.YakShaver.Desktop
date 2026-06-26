import { beforeEach, describe, expect, it, vi } from "vitest";

// control-bar-window.ts imports electron for BrowserWindow + screen. Mock both
// so the module loads in the node test environment and we can capture the IPC
// sends the window makes to the renderer.
const { mockWebContents, mockWindow } = vi.hoisted(() => {
  const mockWebContents = {
    send: vi.fn(),
    isDestroyed: vi.fn(() => false),
    on: vi.fn(),
  };
  const mockWindow = {
    webContents: mockWebContents,
    isDestroyed: vi.fn(() => false),
    destroy: vi.fn(),
    on: vi.fn(),
    setAlwaysOnTop: vi.fn(),
    setContentProtection: vi.fn(),
    loadURL: vi.fn().mockResolvedValue(undefined),
    loadFile: vi.fn().mockResolvedValue(undefined),
    showInactive: vi.fn(),
  };
  return { mockWebContents, mockWindow };
});

vi.mock("electron", () => ({
  BrowserWindow: class MockBrowserWindow {
    webContents = mockWindow.webContents;
    isDestroyed = mockWindow.isDestroyed;
    destroy = mockWindow.destroy;
    on = mockWindow.on;
    setAlwaysOnTop = mockWindow.setAlwaysOnTop;
    setContentProtection = mockWindow.setContentProtection;
    loadURL = mockWindow.loadURL;
    loadFile = mockWindow.loadFile;
    showInactive = mockWindow.showInactive;
  },
  screen: {
    getAllDisplays: vi.fn(() => []),
    getPrimaryDisplay: vi.fn(() => ({
      id: 1,
      workArea: { x: 0, y: 0, width: 1920, height: 1080 },
    })),
  },
}));

import { RecordingControlBarWindow } from "./control-bar-window";

describe("RecordingControlBarWindow (#870)", () => {
  let controlBar: RecordingControlBarWindow;

  beforeEach(() => {
    vi.clearAllMocks();
    mockWindow.isDestroyed.mockReturnValue(false);
    mockWebContents.isDestroyed.mockReturnValue(false);
    // Fresh singleton per test.
    (RecordingControlBarWindow as unknown as { instance?: unknown }).instance = undefined;
    controlBar = RecordingControlBarWindow.getInstance();
    // Use the dev URL path (loadURL) so the window doesn't try to join
    // process.resourcesPath, which is undefined in the node test environment.
    controlBar.initialize(true);
  });

  describe("updateTime", () => {
    it("caches the latest seconds and sends the formatted time to the renderer", async () => {
      await controlBar.showForRecording();
      controlBar.updateTime(65);

      expect(mockWebContents.send).toHaveBeenLastCalledWith("update-recording-time", "01:05");
    });

    it("guards the send with both window and webContents destroyed checks", async () => {
      await controlBar.showForRecording();
      mockWebContents.isDestroyed.mockReturnValue(true);
      mockWebContents.send.mockClear();

      controlBar.updateTime(1);

      expect(mockWebContents.send).not.toHaveBeenCalled();
    });
  });

  describe("getCurrentTime — renderer mount handshake", () => {
    it("returns the live elapsed time from the provider, formatted", () => {
      controlBar.setElapsedProvider(() => 5);
      expect(controlBar.getCurrentTime()).toBe("00:05");
    });

    it("falls back to the last pushed value when the provider has no live time", () => {
      controlBar.setElapsedProvider(() => null);
      controlBar.updateTime(3);
      expect(controlBar.getCurrentTime()).toBe("00:03");
    });

    it("returns null when neither the provider nor a cached value is available", () => {
      controlBar.setElapsedProvider(() => null);
      expect(controlBar.getCurrentTime()).toBeNull();
    });

    it("returns null when no provider has been set and nothing is cached", () => {
      expect(controlBar.getCurrentTime()).toBeNull();
    });

    it("prefers the live provider value over a stale cached value", () => {
      controlBar.updateTime(2);
      controlBar.setElapsedProvider(() => 10);
      expect(controlBar.getCurrentTime()).toBe("00:10");
    });
  });

  describe("hide", () => {
    it("clears the cached time so a subsequent handshake doesn't return a stale value", () => {
      // No live provider -> getCurrentTime relies on the cache.
      controlBar.setElapsedProvider(() => null);
      controlBar.updateTime(7);
      expect(controlBar.getCurrentTime()).toBe("00:07");

      controlBar.hide();

      expect(controlBar.getCurrentTime()).toBeNull();
    });
  });
});
