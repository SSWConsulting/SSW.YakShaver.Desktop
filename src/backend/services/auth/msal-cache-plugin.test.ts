import { promises as fs } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MsalSecureCachePlugin } from "./msal-cache-plugin";

// Mock electron
vi.mock("electron", () => ({
  app: {
    getPath: vi.fn().mockReturnValue("/mock/user/data"),
  },
  safeStorage: {
    isEncryptionAvailable: vi.fn().mockReturnValue(true),
    encryptString: vi.fn((str: string) => Buffer.from(`encrypted:${str}`)),
    decryptString: vi.fn((buf: Buffer) => {
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
    access: vi.fn().mockResolvedValue(undefined),
    mkdir: vi.fn().mockResolvedValue(undefined),
    writeFile: vi.fn().mockResolvedValue(undefined),
    readFile: vi.fn(),
    unlink: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("node:path", () => ({
  join: (...args: string[]) => args.join("/"),
}));

describe("MsalSecureCachePlugin", () => {
  let plugin: MsalSecureCachePlugin;

  const makeContext = (overrides?: object) => ({
    tokenCache: {
      deserialize: vi.fn(),
      serialize: vi.fn().mockReturnValue('{"accounts":[]}'),
    },
    cacheHasChanged: false,
    ...overrides,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    plugin = new MsalSecureCachePlugin();
  });

  describe("beforeCacheAccess", () => {
    it("should deserialize valid cached content", async () => {
      const cachedData = '{"accounts":[{"username":"test@ssw.com.au"}]}';
      // encryptAndStore JSON.stringifies the value before encrypting, so the stored bytes are:
      // encrypted: + JSON.stringify(cachedData). The mock decryptString strips "encrypted:" and
      // JSON.parse then recovers the original string.
      vi.mocked(fs.readFile).mockResolvedValue(Buffer.from(`encrypted:${JSON.stringify(cachedData)}`));

      const context = makeContext();
      await plugin.beforeCacheAccess(context as never);

      expect(context.tokenCache.deserialize).toHaveBeenCalledWith(cachedData);
    });

    it("should skip deserialization when cache file does not exist", async () => {
      vi.mocked(fs.readFile).mockRejectedValue({ code: "ENOENT" });

      const context = makeContext();
      await expect(plugin.beforeCacheAccess(context as never)).resolves.toBeUndefined();
      expect(context.tokenCache.deserialize).not.toHaveBeenCalled();
    });

    /**
     * Reproduces the Windows sign-in bug:
     * On Windows, safeStorage uses DPAPI. When msal-cache.enc was created on a
     * different machine or with a different Windows login, DPAPI throws
     * "The data is invalid." instead of the macOS-specific "Error while decrypting..."
     * message that the old code checked for. This caused the error to escape
     * beforeCacheAccess and break the entire MSAL authentication flow.
     *
     * After the fix, BaseSecureStorage.decryptAndLoad catches ALL platform-specific
     * decryption errors internally and returns null, so storage.read() returns null
     * and auth proceeds to interactive login without ever throwing.
     */
    it("should NOT throw and should skip deserialization when Windows DPAPI error occurs (regression test)", async () => {
      // The file exists on disk (stale from a previous installation or machine)
      vi.mocked(fs.readFile).mockResolvedValue(Buffer.from("stale-dpapi-encrypted-data"));

      // Simulate Windows DPAPI error — this is the exact message that broke sign-in
      const { safeStorage } = await import("electron");
      vi.mocked(safeStorage.decryptString).mockImplementationOnce(() => {
        throw new Error("The data is invalid.");
      });

      const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const context = makeContext();

      // Before the fix this would throw, leaving the user unable to sign in.
      // After the fix, BaseSecureStorage catches the error and returns null.
      await expect(plugin.beforeCacheAccess(context as never)).resolves.toBeUndefined();

      // Token cache should NOT have been deserialized with corrupt data
      expect(context.tokenCache.deserialize).not.toHaveBeenCalled();
      // Warning should have been logged at the BaseSecureStorage level
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("Failed to decrypt"));

      consoleSpy.mockRestore();
    });

    it("should NOT throw and should skip deserialization when macOS decryption error occurs", async () => {
      vi.mocked(fs.readFile).mockResolvedValue(Buffer.from("stale-keychain-encrypted-data"));

      const { safeStorage } = await import("electron");
      vi.mocked(safeStorage.decryptString).mockImplementationOnce(() => {
        throw new Error(
          "Error while decrypting the ciphertext provided to safeStorage.decryptString.",
        );
      });

      const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const context = makeContext();

      await expect(plugin.beforeCacheAccess(context as never)).resolves.toBeUndefined();
      expect(context.tokenCache.deserialize).not.toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("Failed to decrypt"));

      consoleSpy.mockRestore();
    });

    it("should clear cache and NOT throw on unexpected read error", async () => {
      // Simulate an error that escapes BaseSecureStorage (e.g., encryption unavailable)
      vi.mocked(fs.readFile).mockRejectedValue(new Error("EPERM: operation not permitted"));

      const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const context = makeContext();

      await expect(plugin.beforeCacheAccess(context as never)).resolves.toBeUndefined();
      expect(fs.unlink).toHaveBeenCalled();
      expect(context.tokenCache.deserialize).not.toHaveBeenCalled();

      consoleSpy.mockRestore();
    });
  });

  describe("afterCacheAccess", () => {
    it("should write cache when cacheHasChanged is true", async () => {
      const context = makeContext({ cacheHasChanged: true });
      await plugin.afterCacheAccess(context as never);

      expect(fs.writeFile).toHaveBeenCalled();
    });

    it("should NOT write cache when cacheHasChanged is false", async () => {
      const context = makeContext({ cacheHasChanged: false });
      await plugin.afterCacheAccess(context as never);

      expect(fs.writeFile).not.toHaveBeenCalled();
    });

    it("should NOT throw when write fails (auth session must survive a cache write error)", async () => {
      vi.mocked(fs.writeFile).mockRejectedValue(new Error("Disk full"));

      const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const context = makeContext({ cacheHasChanged: true });

      await expect(plugin.afterCacheAccess(context as never)).resolves.toBeUndefined();

      consoleSpy.mockRestore();
    });
  });
});
