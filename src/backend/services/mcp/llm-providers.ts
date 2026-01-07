import { createAzure } from "@ai-sdk/azure";
import { createDeepSeek } from "@ai-sdk/deepseek";
import { createOpenAI } from "@ai-sdk/openai";
import type { ProviderConfig, ProviderName } from "../../types/llm";

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
  azure: {
    factory: createAzure,
  },
} as const;
