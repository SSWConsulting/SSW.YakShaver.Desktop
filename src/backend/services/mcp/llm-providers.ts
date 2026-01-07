import { createAzure } from "@ai-sdk/azure";
import { createDeepSeek } from "@ai-sdk/deepseek";
import { createOpenAI } from "@ai-sdk/openai";
import type { ProviderName } from "@shared/types/llm";
import type { ProviderConfig } from "../../types/llm";

export const LLM_PROVIDER_CONFIGS: Record<ProviderName, ProviderConfig> = {
  deepseek: {
    factory: createDeepSeek,
    defaultProcessingModel: "deepseek-chat",
  },
  openai: {
    factory: createOpenAI,
    defaultTranscriptionModel: "whisper-1",
    defaultProcessingModel: "gpt-5-mini",
  },
  // TODO: This will need to be expanded when Azure is enabled as a provider.
  azure: {
    factory: createAzure,
  },
} as const;
