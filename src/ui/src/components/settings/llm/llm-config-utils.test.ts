import type { LLMConfigV2, ModelConfig } from "@shared/types/llm";
import { describe, expect, it } from "vitest";
import {
  buildConfigWithClearedModel,
  buildConfigWithSavedModel,
  getSavedApiKeyForProvider,
} from "./llm-config-utils";

const languageModel: ModelConfig = {
  provider: "openai",
  model: "gpt-4",
  apiKey: "language-key",
};

const transcriptionModel: ModelConfig = {
  provider: "deepseek",
  model: "deepseek-chat",
  apiKey: "transcription-key",
};

const baseConfig: LLMConfigV2 = {
  version: 2,
  languageModel,
  transcriptionModel,
  providerApiKeys: {
    openai: "language-key",
    deepseek: "transcription-key",
    azure: "azure-key",
  },
};

describe("LLM settings config utilities", () => {
  describe("buildConfigWithClearedModel", () => {
    it("clears language model without changing transcription model", () => {
      const result = buildConfigWithClearedModel(baseConfig, "languageModel");

      expect(result.languageModel).toBeNull();
      expect(result.transcriptionModel).toEqual(transcriptionModel);
    });

    it("clears transcription model without changing language model", () => {
      const result = buildConfigWithClearedModel(baseConfig, "transcriptionModel");

      expect(result.languageModel).toEqual(languageModel);
      expect(result.transcriptionModel).toBeNull();
    });

    it("removes the cleared provider API key when no remaining model uses it", () => {
      const result = buildConfigWithClearedModel(baseConfig, "languageModel");

      expect(result.providerApiKeys).toEqual({
        deepseek: "transcription-key",
        azure: "azure-key",
      });
    });

    it("keeps the cleared provider API key when another model still uses it", () => {
      const sharedProviderConfig: LLMConfigV2 = {
        version: 2,
        languageModel,
        transcriptionModel: {
          provider: "openai",
          model: "whisper-1",
          apiKey: "language-key",
        },
        providerApiKeys: {
          openai: "language-key",
        },
      };

      const result = buildConfigWithClearedModel(sharedProviderConfig, "languageModel");

      expect(result.providerApiKeys).toEqual({
        openai: "language-key",
      });
    });
  });

  describe("orchestrationBackend preservation", () => {
    const configWithBackend: LLMConfigV2 = {
      ...baseConfig,
      orchestrationBackend: "local-claude",
    };

    it("preserves orchestrationBackend when saving a model", () => {
      const result = buildConfigWithSavedModel(configWithBackend, "languageModel", {
        provider: "azure",
        model: "gpt-4o",
        apiKey: "new-azure-key",
        resourceName: "yakshaver-openai",
      });

      expect(result.orchestrationBackend).toBe("local-claude");
    });

    it("preserves orchestrationBackend when clearing a model", () => {
      const result = buildConfigWithClearedModel(configWithBackend, "languageModel");

      expect(result.orchestrationBackend).toBe("local-claude");
    });
  });

  describe("buildConfigWithSavedModel", () => {
    it("saves language model without overwriting the fresh transcription model", () => {
      const updatedLanguageModel: ModelConfig = {
        provider: "azure",
        model: "gpt-4o",
        apiKey: "new-azure-key",
        resourceName: "yakshaver-openai",
      };

      const result = buildConfigWithSavedModel(baseConfig, "languageModel", updatedLanguageModel);

      expect(result.languageModel).toEqual(updatedLanguageModel);
      expect(result.transcriptionModel).toEqual(transcriptionModel);
      expect(result.providerApiKeys).toEqual({
        openai: "language-key",
        deepseek: "transcription-key",
        azure: "new-azure-key",
      });
    });

    it("backfills a missing providerApiKeys entry from the other model slot", () => {
      // Simulates a config saved before providerApiKeys existed: the transcription model has a
      // key on disk, but the cache never captured it.
      const configWithoutCache: LLMConfigV2 = {
        version: 2,
        languageModel,
        transcriptionModel,
        providerApiKeys: { openai: "language-key" },
      };

      const result = buildConfigWithSavedModel(configWithoutCache, "languageModel", {
        provider: "openai",
        model: "gpt-4",
        apiKey: "language-key",
      });

      expect(result.providerApiKeys).toEqual({
        openai: "language-key",
        deepseek: "transcription-key",
      });
    });
  });

  describe("getSavedApiKeyForProvider — provider switch round-trip (#513)", () => {
    it("returns the mapped key when providerApiKeys has an entry", () => {
      const key = getSavedApiKeyForProvider(baseConfig, "languageModel", "deepseek");
      expect(key).toBe("transcription-key");
    });

    it("returns empty string for a provider with no stored key at all", () => {
      const key = getSavedApiKeyForProvider(baseConfig, "languageModel", "deepseek");
      const configWithoutDeepseek: LLMConfigV2 = {
        version: 2,
        languageModel,
        transcriptionModel: null,
        providerApiKeys: { openai: "language-key" },
      };
      expect(getSavedApiKeyForProvider(configWithoutDeepseek, "languageModel", "deepseek")).toBe(
        "",
      );
      expect(key).toBe("transcription-key");
    });

    it("falls back to the saved model config when providerApiKeys is missing the entry (pre-existing config)", () => {
      // Reproduces #513: a config saved before the providerApiKeys cache existed has the key
      // only on languageModel, not in the map. Switching providers must still find it.
      const legacyConfig: LLMConfigV2 = {
        version: 2,
        languageModel: { provider: "openai", model: "gpt-4", apiKey: "sk-legacy-openai-key" },
        transcriptionModel: null,
        providerApiKeys: undefined,
      };

      const key = getSavedApiKeyForProvider(legacyConfig, "languageModel", "openai");
      expect(key).toBe("sk-legacy-openai-key");
    });

    it("does not leak another provider's key when the saved model doesn't match", () => {
      const legacyConfig: LLMConfigV2 = {
        version: 2,
        languageModel: { provider: "openai", model: "gpt-4", apiKey: "sk-legacy-openai-key" },
        transcriptionModel: null,
        providerApiKeys: undefined,
      };

      // Switching to deepseek, which has never been configured, must not return openai's key.
      const key = getSavedApiKeyForProvider(legacyConfig, "languageModel", "deepseek");
      expect(key).toBe("");
    });

    it("round-trips: switch OpenAI -> DeepSeek -> OpenAI restores the original key", () => {
      // Full repro of the reported bug, using only the persisted config (no in-memory state),
      // exactly like BaseModelKeyManager's handleProviderChange does on every switch.
      let config: LLMConfigV2 = {
        version: 2,
        languageModel: { provider: "openai", model: "gpt-4", apiKey: "sk-openai-key" },
        transcriptionModel: null,
        providerApiKeys: { openai: "sk-openai-key" },
      };

      // Switch to DeepSeek: no stored key.
      const deepseekKey = getSavedApiKeyForProvider(config, "languageModel", "deepseek");
      expect(deepseekKey).toBe("");

      // User does not save while on DeepSeek; config on disk is unchanged.

      // Switch back to OpenAI: the original key must still be there.
      const openaiKey = getSavedApiKeyForProvider(config, "languageModel", "openai");
      expect(openaiKey).toBe("sk-openai-key");

      // Even if the user does save while on DeepSeek (with an empty key), OpenAI's key in the
      // provider cache must survive.
      config = buildConfigWithSavedModel(config, "languageModel", {
        provider: "deepseek",
        model: "deepseek-chat",
        apiKey: "",
      });
      expect(getSavedApiKeyForProvider(config, "languageModel", "openai")).toBe("sk-openai-key");
    });
  });
});
