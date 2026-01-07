import type { ProviderV3 } from "@ai-sdk/provider";

export interface ProviderConfig {
  factory: (config: { apiKey: string }) => ProviderV3;
  defaultProcessingModel?: string;
  defaultTranscriptionModel?: string;
}

export type ProviderName = "openai" | "azure" | "deepseek";

// LLM configuration types for backend usage

interface LLMConfigBase {
  provider: ProviderName;
  model: string | null;
  apiKey: string;
}

interface OpenAIConfig extends LLMConfigBase {
  provider: "openai";
}

interface DeepSeekConfig extends LLMConfigBase {
  provider: "deepseek";
}

interface AzureOpenAIConfig extends LLMConfigBase {
  provider: "azure";
  endpoint: string;
  version: string;
  deployment: string;
}

export type LLMConfig = OpenAIConfig | AzureOpenAIConfig | DeepSeekConfig;
