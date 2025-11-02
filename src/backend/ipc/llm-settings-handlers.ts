import { type IpcMainInvokeEvent, ipcMain } from "electron";
import { OpenAIService } from "../services/openai/openai-service";
import { IPC_CHANNELS } from "./channels";
import { LlmStorage, type LLMConfig } from "../services/storage/llm-storage";

export class LLMSettingsIPCHandlers {
  private openAiService = OpenAIService.getInstance();
  private secureStorage = LlmStorage.getInstance();

  constructor() {
    this.registerHandlers();
    void this.bootstrapStoredKey();
  }

  private async bootstrapStoredKey() {
    try {
      const llmCfg = await this.secureStorage.getLLMConfig();
      if (llmCfg) {
        if (llmCfg.provider === "openai") {
          this.openAiService.setOpenAIKey(llmCfg.apiKey);
        } else {
          this.openAiService.setAzureConfig(
            llmCfg.apiKey,
            llmCfg.endpoint,
            llmCfg.version,
            llmCfg.deployment,
          );
        }
        return;
      }
    } catch (e) {
      throw new Error("Failed to bootstrap stored OpenAI key");
    }
  }

  private registerHandlers(): void {
    ipcMain.handle(
      IPC_CHANNELS.LLM_SET_CONFIG,
      async (_event: IpcMainInvokeEvent, config: LLMConfig) => {
        if (!config || !("provider" in config))
          throw new Error("Invalid LLM config");
        await this.secureStorage.storeLLMConfig(config);
        // Reconfigure services
        if (config.provider === "openai") {
          this.openAiService.setOpenAIKey(config.apiKey);
        } else {
          this.openAiService.setAzureConfig(
            config.apiKey,
            config.endpoint,
            config.version,
            config.deployment,
          );
        }
        return { success: true };
      },
    );

    ipcMain.handle(IPC_CHANNELS.LLM_GET_CONFIG, async () => {
      const cfg = await this.secureStorage.getLLMConfig();
      return cfg;
    });

    ipcMain.handle(IPC_CHANNELS.LLM_CLEAR_CONFIG, async () => {
      await this.secureStorage.clearLLMConfig();
      this.openAiService.clearOpenAIClient();
      return { success: true };
    });
  }
}
