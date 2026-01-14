import { promises as fs } from "node:fs";
import type { LLMConfigV1, LLMConfigV2 } from "@shared/types/llm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LlmStorage } from "./llm-storage";

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

describe("LlmStorage", () => {
  let storage: LlmStorage;

  beforeEach(() => {
    vi.clearAllMocks();
    storage = LlmStorage.getInstance();
    storage.resetCache();
  });

  it("should return null when no config exists", async () => {
    // Mock file not found
    vi.mocked(fs.readFile).mockRejectedValue({ code: "ENOENT" });

    const config = await storage.getLLMConfig();
    expect(config).toBeNull();
  });

  describe("Migration V1 -> V2", () => {
    it("should migrate OpenAI V1 config to V2", async () => {
      const v1Config: LLMConfigV1 = {
        provider: "openai",
        apiKey: "sk-test-key",
        model: "gpt-4",
        // version: 1 is optional in the interface but assumed if missing or 1
      };

      // Mock reading V1 config
      vi.mocked(fs.readFile).mockResolvedValue(
        Buffer.from(`encrypted:${JSON.stringify(v1Config)}`),
      );

      const config = await storage.getLLMConfig();

      // Should return V2 config
      expect(config).not.toBeNull();
      expect(config?.version).toBe(2);
      expect(config?.languageModel).toEqual({
        provider: "openai",
        apiKey: "sk-test-key",
        model: "gpt-4",
      });
      expect(config?.transcriptionModel).toEqual({
        provider: "openai",
        apiKey: "sk-test-key",
        model: "gpt-4",
      });

      // Should verify that the migrated config was saved back to disk
      expect(fs.writeFile).toHaveBeenCalled();
      const writeCall = vi.mocked(fs.writeFile).mock.calls[0];
      const writtenData = writeCall[1] as Buffer;
      const decryptedWrittenData = JSON.parse(writtenData.toString().replace("encrypted:", ""));
      expect(decryptedWrittenData.version).toBe(2);
    });

    it("should migrate Azure V1 config to V2 including resourceName", async () => {
      const v1Config: LLMConfigV1 = {
        provider: "azure",
        apiKey: "azure-key",
        model: "gpt-4-32k",
        resourceName: "my-resource",
      };

      // Mock reading V1 config
      vi.mocked(fs.readFile).mockResolvedValue(
        Buffer.from(`encrypted:${JSON.stringify(v1Config)}`),
      );

      const config = await storage.getLLMConfig();

      // Should return V2 config
      expect(config).not.toBeNull();
      expect(config?.version).toBe(2);

      const expectedModelConfig = {
        provider: "azure",
        apiKey: "azure-key",
        model: "gpt-4-32k",
        resourceName: "my-resource",
      };

      expect(config?.languageModel).toEqual(expectedModelConfig);
      expect(config?.transcriptionModel).toEqual(expectedModelConfig);
    });
    it("should return null and clear config if migration fails (invalid provider)", async () => {
      const invalidConfig = {
        provider: "unknown-provider",
        apiKey: "some-key",
      };

      // Mock reading invalid V1 config
      vi.mocked(fs.readFile).mockResolvedValue(
        Buffer.from(`encrypted:${JSON.stringify(invalidConfig)}`),
      );

      // Spy on unlink (used by clearLLMConfig/deleteFile)
      vi.mocked(fs.unlink).mockResolvedValue(undefined);

      const config = await storage.getLLMConfig();

      // Should return null (reset)
      expect(config).toBeNull();

      // Should verify that the file was deleted
      expect(fs.unlink).toHaveBeenCalled();
    });
  });

  describe("V2 Config", () => {
    it("should load V2 config without migration", async () => {
      const v2Config: LLMConfigV2 = {
        version: 2,
        languageModel: {
          provider: "openai",
          apiKey: "lang-key",
          model: "gpt-4",
        },
        transcriptionModel: {
          provider: "deepseek",
          apiKey: "trans-key",
          model: "deepseek-coder",
        },
      };

      // Mock reading V2 config
      vi.mocked(fs.readFile).mockResolvedValue(
        Buffer.from(`encrypted:${JSON.stringify(v2Config)}`),
      );

      // Reset writeFile mock to ensure it's NOT called (no migration needed)
      vi.mocked(fs.writeFile).mockClear();

      const config = await storage.getLLMConfig();

      expect(config).toEqual(v2Config);
      expect(fs.writeFile).not.toHaveBeenCalled();
    });
  });
});
