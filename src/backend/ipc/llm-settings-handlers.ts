import { type IpcMainInvokeEvent, ipcMain } from "electron";
import { OpenAIService } from "../services/openai/openai-service";
import { type LLMConfig, LlmStorage } from "../services/storage/llm-storage";
import { IPC_CHANNELS } from "./channels";
import { LLMClientProvider } from "../services/mcp/llm-client-provider";

export class LLMSettingsIPCHandlers {
  private openAiService = OpenAIService.getInstance();
  private secureStorage = LlmStorage.getInstance();

  constructor() {
    this.registerHandlers();
  }

  private registerHandlers(): void {
    ipcMain.handle(
      IPC_CHANNELS.LLM_SET_CONFIG,
      async (_event: IpcMainInvokeEvent, config: LLMConfig) => {
        if (!config || !("provider" in config)) throw new Error("Invalid LLM config");
        await this.secureStorage.storeLLMConfig(config);
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

    ipcMain.handle(IPC_CHANNELS.LLM_CHECK_HEALTH, async () => {
      return await LLMClientProvider.checkHealthAsync();
    });
  }
}
