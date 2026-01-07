import type { ProviderV3 } from "@ai-sdk/provider";

export interface ProviderConfig<TConfig = { apiKey: string }> {
  factory: (config: TConfig) => ProviderV3;
  defaultProcessingModel?: string;
  defaultTranscriptionModel?: string;
}
