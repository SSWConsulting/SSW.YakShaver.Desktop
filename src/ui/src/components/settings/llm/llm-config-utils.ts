import type { LLMConfigV2, ModelConfig, ProviderName } from "@shared/types/llm";

export type ModelConfigType = "languageModel" | "transcriptionModel";

const EMPTY_LLM_CONFIG: LLMConfigV2 = {
  version: 2,
  languageModel: null,
  transcriptionModel: null,
  providerApiKeys: {},
  orchestrationBackend: undefined,
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
  const otherModelType: ModelConfigType =
    modelType === "languageModel" ? "transcriptionModel" : "languageModel";
  const otherModel = baseConfig[otherModelType];

  const providerApiKeys: Partial<Record<ProviderName, string>> = {
    ...baseConfig.providerApiKeys,
  };

  // Backfill the other slot's key too, in case it predates the providerApiKeys cache — a
  // save from one panel should never cause the other panel's already-saved key to look lost.
  if (otherModel?.apiKey && !providerApiKeys[otherModel.provider]) {
    providerApiKeys[otherModel.provider] = otherModel.apiKey;
  }

  providerApiKeys[values.provider] = values.apiKey;

  return {
    version: 2,
    languageModel: baseConfig.languageModel,
    transcriptionModel: baseConfig.transcriptionModel,
    providerApiKeys,
    orchestrationBackend: baseConfig.orchestrationBackend,
    [modelType]: values,
  };
}

/**
 * Resolve the saved API key for a given provider, for a given model slot.
 *
 * `providerApiKeys` is the durable per-provider cache, but it can be missing or stale for
 * configs that predate it (or that were only ever written directly to `languageModel` /
 * `transcriptionModel`). Fall back to the currently-saved model config for this slot when its
 * provider matches, so a key already on disk is never reported as absent.
 */
export function getSavedApiKeyForProvider(
  config: LLMConfigV2 | null,
  modelType: ModelConfigType,
  provider: ProviderName,
): string {
  const baseConfig = getBaseConfig(config);

  const mappedKey = baseConfig.providerApiKeys?.[provider];
  if (mappedKey) {
    return mappedKey;
  }

  const savedModel = baseConfig[modelType];
  if (savedModel && savedModel.provider === provider && savedModel.apiKey) {
    return savedModel.apiKey;
  }

  return "";
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
    orchestrationBackend: baseConfig.orchestrationBackend,
    [modelType]: null,
  };
}
