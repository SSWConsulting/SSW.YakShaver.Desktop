export type ProviderName = "openai" | "azure" | "deepseek";

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
  resourceName: string;
}

export type ModelConfig = OpenAIConfig | AzureOpenAIConfig | DeepSeekConfig;

export type LLMConfigV1 = ModelConfig & {
  version?: 1;
};

export interface LLMConfigV2 {
  version: 2;
  processingModel: ModelConfig;
  transcriptionModel: ModelConfig;
}

export type LLMConfig = LLMConfigV1 | LLMConfigV2;
