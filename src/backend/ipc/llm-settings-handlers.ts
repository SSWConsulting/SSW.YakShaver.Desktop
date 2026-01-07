import { type IpcMainInvokeEvent, ipcMain } from "electron";
import { LLMClientProvider } from "../services/mcp/llm-client-provider";
import { LlmStorage } from "../services/storage/llm-storage";
import type { LLMConfig } from "../types/llm";
import { IPC_CHANNELS } from "./channels";

export class LLMSettingsIPCHandlers {
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
      return { success: true };
    });

    ipcMain.handle(IPC_CHANNELS.LLM_CHECK_HEALTH, async () => {
      return await LLMClientProvider.checkHealthAsync();
    });
  }
}
