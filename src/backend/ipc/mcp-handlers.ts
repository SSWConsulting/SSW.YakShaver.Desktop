import { BrowserWindow, type IpcMainInvokeEvent, ipcMain } from "electron";
import { buildTaskExecutionPrompt } from "../services/openai/prompts";
import type { MCPOrchestrator } from "../services/mcp/mcp-orchestrator";
import type { MCPServerConfig } from "../services/mcp/types";
import { CustomPromptStorage } from "../services/storage/custom-prompt-storage";
import { IPC_CHANNELS } from "./channels";

export class McpIPCHandlers {
  private orchestrator: MCPOrchestrator;
  private settingsStore: CustomPromptStorage;

  constructor(orchestrator: MCPOrchestrator) {
    this.orchestrator = orchestrator;
    this.settingsStore = CustomPromptStorage.getInstance();
    this.registerHandlers();
  }

  private registerHandlers(): void {
    ipcMain.handle(IPC_CHANNELS.MCP_LIST_SERVERS, async () => {
      return this.orchestrator.listAvailableServers();
    });

    ipcMain.handle(
      IPC_CHANNELS.MCP_ADD_SERVER,
      async (_event: IpcMainInvokeEvent, config: MCPServerConfig) => {
        await this.orchestrator.addServer(config);
        return { success: true };
      },
    );

    ipcMain.handle(
      IPC_CHANNELS.MCP_UPDATE_SERVER,
      async (_event: IpcMainInvokeEvent, name: string, config: MCPServerConfig) => {
        await this.orchestrator.updateServer(name, config);
        return { success: true };
      },
    );

    ipcMain.handle(
      IPC_CHANNELS.MCP_REMOVE_SERVER,
      async (_event: IpcMainInvokeEvent, name: string) => {
        await this.orchestrator.removeServer(name);
        return { success: true };
      },
    );
    ipcMain.handle(
      IPC_CHANNELS.MCP_PROCESS_MESSAGE,
      async (_event: IpcMainInvokeEvent, prompt: string, options?: { serverFilter?: string[] }) => {
        const activePrompt = await this.settingsStore.getActivePrompt();
        const customPromptContent = activePrompt?.content || "";
        const systemPrompt = buildTaskExecutionPrompt(customPromptContent);

        return await this.orchestrator.processMessage(prompt, {
          ...options,
          systemPrompt,
        });
      },
    );

    ipcMain.on(IPC_CHANNELS.MCP_PREFILL_PROMPT, (_event, text: string) => {
      BrowserWindow.getAllWindows().forEach((win) => {
        if (!win.isDestroyed()) {
          win.webContents.send(IPC_CHANNELS.MCP_PREFILL_PROMPT, text);
        }
      });
    });
  }
}
