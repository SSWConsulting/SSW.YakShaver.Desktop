import { join } from "node:path";
import { BaseSecureStorage } from "./base-secure-storage";

// LLM configuration types for backend usage

interface LLMConfigBase {
  provider: string;
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
  endpoint: string;
  version: string;
  deployment: string;
}

export type LLMConfig = OpenAIConfig | AzureOpenAIConfig | DeepSeekConfig;

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
