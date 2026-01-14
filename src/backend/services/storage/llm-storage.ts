import { join } from "node:path";
import type {
  AzureOpenAIConfig,
  LLMConfig,
  LLMConfigV1,
  LLMConfigV2,
  ModelConfig,
} from "@shared/types/llm";

import { BaseSecureStorage } from "./base-secure-storage";

const LLM_CONFIG_FILE = "llm-config.enc";

const LLM_PROVIDER_VERSION = 2;

export class LlmStorage extends BaseSecureStorage {
  private static instance: LlmStorage;
  private cachedConfig: LLMConfigV2 | null = null;
  private isLoaded = false;
  private loadPromise: Promise<LLMConfigV2 | null> | null = null;

  // Migration from V1 to V2
  private migrateV1toV2(config: LLMConfigV1): LLMConfigV2 {
    console.log("[LlmStorage]: Migrating V1 -> V2");
    console.log("[LlmStorage]: V1 Config:", config);
    if (!config || typeof config !== "object") {
      throw new Error("[LlmStorage]: Invalid V1 config object during migration");
    }

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
      const provider = (config as { provider: string }).provider;
      throw new Error(`[LlmStorage]: Unknown provider '${provider}' during migration`);
    }
    return {
      version: 2,
      languageModel: modelConfig,
      transcriptionModel: modelConfig,
    };
  }

  // Migration from V2 to V2 (no-op)
  private migrateV2toV2(config: LLMConfigV2): LLMConfigV2 {
    return config;
  }

  private constructor() {
    super();
  }

  public static getInstance(): LlmStorage {
    if (!LlmStorage.instance) {
      LlmStorage.instance = new LlmStorage();
    }
    return LlmStorage.instance;
  }

  /**
   * Resets the internal cache. Used primarily for testing.
   */
  public resetCache(): void {
    this.cachedConfig = null;
    this.isLoaded = false;
    this.loadPromise = null;
  }

  private getLLMConfigPath(): string {
    return join(this.storageDir, LLM_CONFIG_FILE);
  }

  async storeLLMConfig(config: LLMConfigV2): Promise<void> {
    console.log("[LlmStorage]: Storing LLM config:", config);
    await this.encryptAndStore(this.getLLMConfigPath(), config);
    this.cachedConfig = config;
    this.isLoaded = true;
  }

  async getLLMConfig(): Promise<LLMConfigV2 | null> {
    if (this.isLoaded) {
      console.log("[LlmStorage]: Returning cached LLM config", this.cachedConfig);
      return this.cachedConfig;
    }

    if (this.loadPromise) {
      return this.loadPromise;
    }

    this.loadPromise = (async () => {
      try {
        const config = await this.decryptAndLoad<LLMConfig>(this.getLLMConfigPath());
        console.log("[LlmStorage]: Loaded LLM config from storage:", config);

        if (!config) {
          this.cachedConfig = null;
          this.isLoaded = true;
          return null;
        }

        const configVersion = "version" in config ? config.version : 1;
        console.log(`[LlmStorage]: Loaded LLM config version: ${configVersion}`);
        try {
          const migratedConfig = this.migrateToCurrentVersion(config);
          console.log("[LlmStorage]: Migrated LLM config:", migratedConfig);
          // If migration happened (version changed), save it
          if (configVersion !== LLM_PROVIDER_VERSION) {
            console.log(
              `[LlmStorage]: LLM config version ${configVersion} detected, migrating to version ${LLM_PROVIDER_VERSION}`,
            );
            await this.storeLLMConfig(migratedConfig);
          } else {
            this.cachedConfig = migratedConfig;
            this.isLoaded = true;
          }
          return migratedConfig;
        } catch (error) {
          console.error(
            `[LlmStorage]: Migration failed for version ${configVersion}, resetting config. Error:`,
            error,
          );
          await this.clearLLMConfig();
          this.cachedConfig = null;
          this.isLoaded = true;
          return null;
        }
      } finally {
        this.loadPromise = null;
      }
    })();
    return this.loadPromise;
  }

  async clearLLMConfig(): Promise<void> {
    await this.deleteFile(this.getLLMConfigPath());
    this.cachedConfig = null;
    this.isLoaded = true;
  }

  async hasLLMConfig(): Promise<boolean> {
    return await this.fileExists(this.getLLMConfigPath());
  }

  private migrateToCurrentVersion(config: LLMConfigV1 | LLMConfigV2): LLMConfigV2 {
    console.log("[LlmStorage]: migrateToCurrentVersion called with config:", config);
    let currentConfig: LLMConfigV1 | LLMConfigV2 = config;
    console.log(`[LlmStorage]: Current config version: ${config.version}`);
    const startVersion = config.version ?? 1;
    console.log(
      `[LlmStorage]: Starting migration from version ${startVersion} to ${LLM_PROVIDER_VERSION}`,
    );
    for (let v = startVersion; v < LLM_PROVIDER_VERSION; v++) {
      console.log(`${v}`);
      console.log(`[LlmStorage]: Migrating to version ${v + 1}`);
      if (v === 1) {
        currentConfig = this.migrateV1toV2(currentConfig as LLMConfigV1);
      } else if (v === 2) {
        currentConfig = this.migrateV2toV2(currentConfig as LLMConfigV2);
      } else {
        throw new Error(`[LlmStorage]: No migration handler for version ${v}`);
      }
    }

    return currentConfig as LLMConfigV2;
  }
}
