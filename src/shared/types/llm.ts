export type ProviderName = "openai" | "azure" | "deepseek";

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

export interface AzureOpenAIConfig extends LLMConfigBase {
  provider: "azure";
  resourceName: string;
}

export type ModelConfig = OpenAIConfig | AzureOpenAIConfig | DeepSeekConfig;

export type LLMConfigV1 = ModelConfig & {
  version?: 1;
};

export interface LLMConfigV2 {
  version: 2;
  languageModel: ModelConfig;
  transcriptionModel: ModelConfig;
}

export type LLMConfig = LLMConfigV1 | LLMConfigV2;
