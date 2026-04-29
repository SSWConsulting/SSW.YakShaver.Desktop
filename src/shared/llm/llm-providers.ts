import { createAzure } from "@ai-sdk/azure";
import { createDeepSeek } from "@ai-sdk/deepseek";
import { createOpenAI } from "@ai-sdk/openai";
import { featureFlags } from "../config/endpoints";
import type { ProviderName } from "@shared/types/llm";
import type { ProviderConfig } from "../../backend/types/llm";

const ALL_LLM_PROVIDER_CONFIGS: Record<ProviderName, ProviderConfig> = {
  deepseek: {
    label: "DeepSeek",
    factory: createDeepSeek,
    defaultLanguageModel: "deepseek-chat",
  },
  openai: {
    label: "OpenAI",
    factory: createOpenAI,
    defaultTranscriptionModel: "whisper-1",
    defaultLanguageModel: "gpt-5.2",
  },
  // TODO: This will need to be expanded when Azure is enabled as a provider.
  // https://github.com/SSWConsulting/SSW.YakShaver.Desktop/issues/530
  azure: {
    label: "Azure OpenAI",
    factory: createAzure,
  },
};

/**
 * Region-filtered LLM provider configs. China build excludes Western providers
 * (currently only DeepSeek is permitted; verify SDK does not phone home in a follow-up
 * before relying on it for production traffic).
 *
 * Type is widened to Record<...> for callsite ergonomics; consumers that index by
 * a runtime-chosen provider name should optional-chain the result.
 */
export const LLM_PROVIDER_CONFIGS: Record<ProviderName, ProviderConfig> = (() => {
  const filtered: Partial<Record<ProviderName, ProviderConfig>> = {};
  if (featureFlags.llmProviderDeepseek) filtered.deepseek = ALL_LLM_PROVIDER_CONFIGS.deepseek;
  if (featureFlags.llmProviderOpenai) filtered.openai = ALL_LLM_PROVIDER_CONFIGS.openai;
  if (featureFlags.llmProviderAzureOpenai) filtered.azure = ALL_LLM_PROVIDER_CONFIGS.azure;
  return filtered as Record<ProviderName, ProviderConfig>;
})();
