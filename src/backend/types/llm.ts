import type { ProviderV4 } from "@ai-sdk/provider";

export interface ProviderConfig<TConfig = { apiKey: string }> {
  label: string;
  factory: (config: TConfig) => ProviderV4;
  defaultLanguageModel?: string;
  defaultTranscriptionModel?: string;
}
