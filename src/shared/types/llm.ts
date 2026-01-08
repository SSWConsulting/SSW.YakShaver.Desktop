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
  endpoint: string;
  version: string;
  deployment: string;
}

export type LLMConfig = OpenAIConfig | AzureOpenAIConfig | DeepSeekConfig;
