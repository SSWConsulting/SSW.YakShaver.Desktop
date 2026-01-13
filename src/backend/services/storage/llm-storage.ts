import { join } from "node:path";
import type {
  AzureOpenAIConfig,
  LLMConfig,
  LLMConfigV1,
  LLMConfigV2,
  ModelConfig,
} from "@shared/types/llm";

type MigrationMap = {
  1: (config: LLMConfigV1) => LLMConfigV2;
  2: (config: LLMConfigV2) => LLMConfigV2;
};

import { BaseSecureStorage } from "./base-secure-storage";

const LLM_CONFIG_FILE = "llm-config.enc";

const LLM_PROVIDER_VERSION = 2;

export class LlmStorage extends BaseSecureStorage {
  private static instance: LlmStorage;

  /**
   * Migration registry - add new migrations here as versions evolve
   */
  private migrations: MigrationMap = {
    1: (config: LLMConfigV1) => {
      console.log("[LlmStorage]: Migrating V1 -> V2");
      let modelConfig: ModelConfig;
      if (config.provider === "openai") {
        modelConfig = {
          provider: "openai",
          model: config.model,
          apiKey: config.apiKey,
        };
      } else if (config.provider === "azure") {
        modelConfig = {
          provider: "azure",
          model: config.model,
          apiKey: config.apiKey,
          resourceName: (config as AzureOpenAIConfig).resourceName || "",
        };
      } else if (config.provider === "deepseek") {
        modelConfig = {
          provider: "deepseek",
          model: config.model,
          apiKey: config.apiKey,
        };
      } else {
        throw new Error(`[LlmStorage]: Unknown provider ${config} during migration`);
      }
      return {
        version: 2,
        languageModel: modelConfig,
        transcriptionModel: modelConfig,
      };
    },
    2: (config: LLMConfigV2) => config,
  };

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

  async storeLLMConfig(config: LLMConfigV2): Promise<void> {
    await this.encryptAndStore(this.getLLMConfigPath(), config);
  }

  async getLLMConfig(): Promise<LLMConfigV2 | null> {
    const config = await this.decryptAndLoad<LLMConfig>(this.getLLMConfigPath());

    if (!config) {
      return null;
    }

    const configVersion = "version" in config ? config.version : 1;

    if (configVersion === LLM_PROVIDER_VERSION) {
      return config as LLMConfigV2;
    }

    console.log(
      `[LlmStorage]: LLM config version ${configVersion} detected, migrating to version ${LLM_PROVIDER_VERSION}`,
    );
    const migratedConfig = this.migrateToCurrentVersion(config);

    await this.storeLLMConfig(migratedConfig);
    return migratedConfig;
  }

  async clearLLMConfig(): Promise<void> {
    await this.deleteFile(this.getLLMConfigPath());
  }

  async hasLLMConfig(): Promise<boolean> {
    return await this.fileExists(this.getLLMConfigPath());
  }

  private migrateToCurrentVersion(config: LLMConfigV1 | LLMConfigV2): LLMConfigV2 {
    let currentConfig: LLMConfigV1 | LLMConfigV2 = config;
    const startVersion = config.version ?? 1;

    for (let v = startVersion; v < LLM_PROVIDER_VERSION; v++) {
      const migration = this.migrations[v as keyof MigrationMap];
      if (!migration) {
        throw new Error(`[LlmStorage]: Missing migration for version ${v}`);
      }
      // Type narrowing for migration input
      currentConfig = migration(currentConfig);
    }

    return currentConfig as LLMConfigV2;
  }
}
