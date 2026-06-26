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

export type ProviderApiKeys = Readonly<Partial<Record<ProviderName, string>>>;

/**
 * Which backend drives the backlog-creation (EXECUTING_TASK) step.
 * - `openai`: the in-process MCPOrchestrator loop (default, original behaviour).
 * - `local-claude`: drive the step with a local `claude -p` (headless) process.
 */
export type OrchestrationBackend = "openai" | "local-claude";

export const DEFAULT_ORCHESTRATION_BACKEND: OrchestrationBackend = "openai";

export type LLMConfigV1 = ModelConfig & {
  version?: 1;
};

export interface LLMConfigV2 {
  version: 2;
  languageModel: ModelConfig | null;
  transcriptionModel: ModelConfig | null;
  /** Persisted API keys per provider, enabling restoration when switching providers */
  providerApiKeys?: ProviderApiKeys;
  /**
   * Opt-in orchestration backend for the backlog-creation step.
   * Absent/undefined behaves exactly as `openai` — existing configs are unaffected.
   */
  orchestrationBackend?: OrchestrationBackend;
}

export type LLMConfig = LLMConfigV1 | LLMConfigV2;
