import { promises as fs } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { KeyboardShortcutStorage } from "./keyboard-shortcut-storage";

// Mock electron
vi.mock("electron", () => ({
  app: {
    getPath: vi.fn().mockReturnValue("/mock/user/data"),
  },
  safeStorage: {
    isEncryptionAvailable: vi.fn().mockReturnValue(true),
    encryptString: vi.fn((str) => Buffer.from(`encrypted:${str}`)),
    decryptString: vi.fn((buf) => {
      const str = buf.toString();
      if (str.startsWith("encrypted:")) {
        return str.replace("encrypted:", "");
      }
      return str;
    }),
  },
}));

// Mock fs
vi.mock("node:fs", () => ({
  promises: {
    access: vi.fn().mockResolvedValue(undefined),
    mkdir: vi.fn().mockResolvedValue(undefined),
    writeFile: vi.fn().mockResolvedValue(undefined),
    readFile: vi.fn(),
    unlink: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("electron-log", () => ({
  default: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

describe("KeyboardShortcutStorage", () => {
  let storage: KeyboardShortcutStorage;

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset the singleton for each test by accessing the private instance
    // @ts-expect-error - accessing private static for testing
    KeyboardShortcutStorage.instance = undefined;
    storage = KeyboardShortcutStorage.getInstance();
  });

  describe("getInstance", () => {
    it("should create storage instance", () => {
      expect(storage).toBeDefined();
    });

    it("should return same instance on multiple calls", () => {
      const instance2 = KeyboardShortcutStorage.getInstance();
      expect(storage).toBe(instance2);
    });
  });

  describe("getSettings", () => {
    it("should return default settings when no stored value", async () => {
      vi.mocked(fs.readFile).mockRejectedValue({ code: "ENOENT" });

      const settings = await storage.getSettings();
      expect(settings.recordShortcut).toBe("PrintScreen");
      expect(settings.autoLaunchEnabled).toBe(false);
    });

    it("should return stored settings when file exists", async () => {
      const storedSettings = {
        recordShortcut: "CommandOrControl+Shift+R",
        autoLaunchEnabled: true,
      };
      vi.mocked(fs.readFile).mockResolvedValue(
        Buffer.from(`encrypted:${JSON.stringify(storedSettings)}`),
      );

      const settings = await storage.getSettings();
      expect(settings.recordShortcut).toBe("CommandOrControl+Shift+R");
      expect(settings.autoLaunchEnabled).toBe(true);
    });
  });

  describe("setRecordShortcut", () => {
    it("should save shortcut to file", async () => {
      vi.mocked(fs.readFile).mockRejectedValue({ code: "ENOENT" });

      await storage.setRecordShortcut("CommandOrControl+F12");
      expect(vi.mocked(fs.writeFile)).toHaveBeenCalled();
    });
  });

  describe("setAutoLaunch", () => {
    it("should save auto launch setting", async () => {
      vi.mocked(fs.readFile).mockRejectedValue({ code: "ENOENT" });

      await storage.setAutoLaunch(true);
      expect(vi.mocked(fs.writeFile)).toHaveBeenCalled();
    });
  });
});
