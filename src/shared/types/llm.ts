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

export type ProviderApiKeys = Readonly<Partial<Record<ProviderName, string>>>;

/**
 * Which backend drives the backlog-creation (EXECUTING_TASK) step.
 * - `openai`: the in-process MCPOrchestrator loop (default, original behaviour).
 * - `local-claude`: drive the step with a local `claude -p` (headless) process.
 */
export type OrchestrationBackend = "openai" | "local-claude" | "cloud-360";

export const DEFAULT_ORCHESTRATION_BACKEND: OrchestrationBackend = "openai";

/**
 * Readiness of the local Claude Code (`local-claude`) orchestration backend, surfaced to the
 * settings UI so the user learns BEFORE a run that Claude Code can't be driven.
 *
 * - `not-installed`     — the `claude` CLI isn't on PATH.
 * - `not-authenticated` — the CLI is installed but no credentials were detected.
 * - `ready`             — installed and (best-effort) authenticated.
 */
export type OrchestratorReadinessState = "ready" | "not-installed" | "not-authenticated";

export interface OrchestratorReadiness {
  installed: boolean;
  authenticated: boolean;
  ready: boolean;
  state: OrchestratorReadinessState;
  /** Short, user-facing guidance. Empty when ready. */
  message: string;
}

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
