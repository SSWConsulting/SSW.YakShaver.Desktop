import { promises as fs } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_USER_SETTINGS, type UserSettings } from "../../../shared/types/user-settings";
import { UserSettingsStorage } from "./user-settings-storage";

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

// Mock node:fs
vi.mock("node:fs", () => ({
  promises: {
    access: vi.fn().mockResolvedValue(undefined), // Defaults to file existing/accessible for ensureDir
    mkdir: vi.fn().mockResolvedValue(undefined),
    writeFile: vi.fn().mockResolvedValue(undefined),
    readFile: vi.fn(),
    unlink: vi.fn().mockResolvedValue(undefined),
  },
}));

describe("UserSettingsStorage", () => {
  let storage: UserSettingsStorage;

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset singleton instance to ensure fresh state for each test
    // @ts-expect-error - accessing private property for test isolation
    UserSettingsStorage.instance = null;
    storage = UserSettingsStorage.getInstance();
  });

  describe("getSettingsAsync", () => {
    it("should return default settings when no settings file exists", async () => {
      // Mock ENOENT (file not found)
      vi.mocked(fs.readFile).mockRejectedValueOnce({ code: "ENOENT" });

      const settings = await storage.getSettingsAsync();

      expect(settings).toEqual(DEFAULT_USER_SETTINGS);
      // It should NOT try to write defaults to disk implicitly on get (based on current implementation)
      expect(fs.writeFile).not.toHaveBeenCalled();
    });

    it("should load and decrypt existing settings", async () => {
      const storedSettings: UserSettings = {
        ...DEFAULT_USER_SETTINGS,
        openAtLogin: true,
        toolApprovalMode: "yolo",
      };

      vi.mocked(fs.readFile).mockResolvedValueOnce(
        Buffer.from(`encrypted:${JSON.stringify(storedSettings)}`),
      );

      const settings = await storage.getSettingsAsync();

      expect(settings).toEqual(storedSettings);
      expect(fs.readFile).toHaveBeenCalledTimes(1);
    });

    it("should merge stored settings with defaults (handling missing fields)", async () => {
      // Simulating a scenario where stored settings might be older or partial
      const partialStored = {
        openAtLogin: true,
        // toolApprovalMode is missing
      };

      vi.mocked(fs.readFile).mockResolvedValueOnce(
        Buffer.from(`encrypted:${JSON.stringify(partialStored)}`),
      );

      const settings = await storage.getSettingsAsync();

      expect(settings).toEqual({
        ...DEFAULT_USER_SETTINGS,
        openAtLogin: true,
      });
      expect(settings.toolApprovalMode).toBe(DEFAULT_USER_SETTINGS.toolApprovalMode);
    });
  });

  describe("updateSettingsAsync", () => {
    it("should update settings and save to disk", async () => {
      // Setup initial state (defaults)
      vi.mocked(fs.readFile).mockRejectedValueOnce({ code: "ENOENT" });

      const updatePatch: Partial<UserSettings> = {
        toolApprovalMode: "wait",
      };

      await storage.updateSettingsAsync(updatePatch);

      // Verify the full object was saved
      expect(fs.writeFile).toHaveBeenCalledTimes(1);
      const writeCall = vi.mocked(fs.writeFile).mock.calls[0];
      const writtenData = writeCall[1] as Buffer;
      const savedJson = JSON.parse(writtenData.toString().replace("encrypted:", ""));

      expect(savedJson).toEqual({
        ...DEFAULT_USER_SETTINGS,
        toolApprovalMode: "wait",
      });
    });

    it("should merge updates with existing cached settings", async () => {
      // 1. Initial Load
      const initialSettings: UserSettings = {
        ...DEFAULT_USER_SETTINGS,
        openAtLogin: true,
      };
      vi.mocked(fs.readFile).mockResolvedValueOnce(
        Buffer.from(`encrypted:${JSON.stringify(initialSettings)}`),
      );

      await storage.getSettingsAsync(); // Populates cache

      // 2. Update
      await storage.updateSettingsAsync({ toolApprovalMode: "yolo" });

      // 3. Verify Final State
      const current = await storage.getSettingsAsync(); // Should hit cache
      expect(current).toEqual({
        ...DEFAULT_USER_SETTINGS,
        openAtLogin: true,
        toolApprovalMode: "yolo",
      });

      // Verify write
      const writeCall = vi.mocked(fs.writeFile).mock.calls[0];
      const writtenData = writeCall[1] as Buffer;
      const savedJson = JSON.parse(writtenData.toString().replace("encrypted:", ""));
      expect(savedJson).toEqual(current);
    });
  });
});
