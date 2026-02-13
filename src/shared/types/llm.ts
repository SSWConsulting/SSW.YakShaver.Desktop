export type ProviderName = "openai" | "azure" | "deepseek" | "byteplus";

interface LLMConfigBase {
  provider: ProviderName;
  model: string | null;
  apiKey: string;
}

export interface OpenAIConfig extends LLMConfigBase {
  provider: "openai";
}

export interface DeepSeekConfig extends LLMConfigBase {
  provider: "deepseek";
}

export interface BytePlusConfig extends LLMConfigBase {
  provider: "byteplus";
}

export interface AzureOpenAIConfig extends LLMConfigBase {
  provider: "azure";
  resourceName: string;
}

export type ModelConfig = OpenAIConfig | AzureOpenAIConfig | DeepSeekConfig | BytePlusConfig;

export type LLMConfigV1 = ModelConfig & {
  version?: 1;
};

export interface LLMConfigV2 {
  version: 2;
  languageModel: ModelConfig | null;
  transcriptionModel: ModelConfig | null;
}

export type LLMConfig = LLMConfigV1 | LLMConfigV2;

