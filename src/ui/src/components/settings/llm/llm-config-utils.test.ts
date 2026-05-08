import type { LLMConfigV2, ModelConfig } from "@shared/types/llm";
import { describe, expect, it } from "vitest";
import { buildConfigWithClearedModel, buildConfigWithSavedModel } from "./llm-config-utils";

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
  });
});
