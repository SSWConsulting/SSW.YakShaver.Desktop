import { join } from "node:path";
import { BaseSecureStorage } from "./base-secure-storage";

// LLM configuration types for backend usage
export interface OpenAIConfig {
  provider: "openai";
  apiKey: string;
}

export interface AzureOpenAIConfig {
  provider: "azure";
  apiKey: string;
  endpoint: string;
  version: string;
  deployment: string;
}

export type LLMConfig = OpenAIConfig | AzureOpenAIConfig;

const LLM_CONFIG_FILE = "llm-config.enc";

export class LlmStorage extends BaseSecureStorage {
  private static instance: LlmStorage;

  private constructor() {
    super();
  }

  public static getInstance(): LlmStorage {
    if (!LlmStorage.instance) {
      LlmStorage.instance = new LlmStorage();
    }
    return LlmStorage.instance;
  }

  private getLLMConfigPath(): string {
    return join(this.storageDir, LLM_CONFIG_FILE);
  }

  async storeLLMConfig(config: LLMConfig): Promise<void> {
    await this.encryptAndStore(this.getLLMConfigPath(), config);
  }

  async getLLMConfig(): Promise<LLMConfig | null> {
    return await this.decryptAndLoad<LLMConfig>(this.getLLMConfigPath());
  }

  async clearLLMConfig(): Promise<void> {
    await this.deleteFile(this.getLLMConfigPath());
  }

  async hasLLMConfig(): Promise<boolean> {
    return await this.fileExists(this.getLLMConfigPath());
  }
}
