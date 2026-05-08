import type { LLMConfigV2, ModelConfig, ProviderName } from "@shared/types/llm";

export type ModelConfigType = "languageModel" | "transcriptionModel";

const EMPTY_LLM_CONFIG: LLMConfigV2 = {
  version: 2,
  languageModel: null,
  transcriptionModel: null,
  providerApiKeys: {},
};

function getBaseConfig(config: LLMConfigV2 | null): LLMConfigV2 {
  return config ?? EMPTY_LLM_CONFIG;
}

export function buildConfigWithSavedModel(
  config: LLMConfigV2 | null,
  modelType: ModelConfigType,
  values: ModelConfig,
): LLMConfigV2 {
  const baseConfig = getBaseConfig(config);

  return {
    version: 2,
    languageModel: baseConfig.languageModel,
    transcriptionModel: baseConfig.transcriptionModel,
    providerApiKeys: {
      ...baseConfig.providerApiKeys,
      [values.provider]: values.apiKey,
    },
    [modelType]: values,
  };
}

export function buildConfigWithClearedModel(
  config: LLMConfigV2 | null,
  modelType: ModelConfigType,
): LLMConfigV2 {
  const baseConfig = getBaseConfig(config);
  const modelToClear = baseConfig[modelType];
  const otherModelType: ModelConfigType =
    modelType === "languageModel" ? "transcriptionModel" : "languageModel";
  const otherModel = baseConfig[otherModelType];
  const providerApiKeys: Partial<Record<ProviderName, string>> = {
    ...baseConfig.providerApiKeys,
  };

  if (modelToClear && otherModel?.provider !== modelToClear.provider) {
    delete providerApiKeys[modelToClear.provider];
  }

  return {
    version: 2,
    languageModel: baseConfig.languageModel,
    transcriptionModel: baseConfig.transcriptionModel,
    providerApiKeys,
    [modelType]: null,
  };
}
