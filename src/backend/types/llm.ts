import type { ProviderV3 } from "@ai-sdk/provider";

export interface ProviderConfig {
  factory: (config: { apiKey: string }) => ProviderV3;
  defaultProcessingModel?: string;
  defaultTranscriptionModel?: string;
}
