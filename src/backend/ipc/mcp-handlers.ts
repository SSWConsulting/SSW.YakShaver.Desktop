import { BrowserWindow, type IpcMainInvokeEvent, ipcMain } from "electron";
import type { MCPOrchestrator } from "../services/mcp/mcp-orchestrator";
import type { MCPServerConfig } from "../services/mcp/types";
import { IPC_CHANNELS } from "./channels";

export class McpIPCHandlers {
  private orchestrator: MCPOrchestrator;

  constructor(orchestrator: MCPOrchestrator) {
    this.orchestrator = orchestrator;
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
      }
    );

    ipcMain.handle(
      IPC_CHANNELS.MCP_UPDATE_SERVER,
      async (
        _event: IpcMainInvokeEvent,
        name: string,
        config: MCPServerConfig
      ) => {
        await this.orchestrator.updateServer(name, config);
        return { success: true };
      }
    );

    ipcMain.handle(
      IPC_CHANNELS.MCP_REMOVE_SERVER,
      async (_event: IpcMainInvokeEvent, name: string) => {
        await this.orchestrator.removeServer(name);
        return { success: true };
      }
    );

    ipcMain.handle(
      IPC_CHANNELS.MCP_CHECK_SERVER_HEALTH,
      async (_event: IpcMainInvokeEvent, name: string) => {
        return await this.orchestrator.checkServerHealth(name);
      }
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
