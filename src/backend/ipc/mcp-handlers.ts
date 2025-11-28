import { BrowserWindow, type IpcMainInvokeEvent, ipcMain } from "electron";
import type { VideoUploadResult } from "../services/auth/types";
import { MCPOrchestrator } from "../services/mcp/mcp-orchestrator";
import type { MCPServerManager } from "../services/mcp/mcp-server-manager";
import type { MCPServerConfig, MCPToolSummary } from "../services/mcp/types";
import { IPC_CHANNELS } from "./channels";

type ProcessMessageOptions = Parameters<MCPOrchestrator["manualLoopAsync"]>[2];

export class McpIPCHandlers {
  private mcpServerManager: MCPServerManager;

  constructor(mcpServerManager: MCPServerManager) {
    this.mcpServerManager = mcpServerManager;
    this.registerHandlers();
  }

  private registerHandlers(): void {
    ipcMain.handle(IPC_CHANNELS.MCP_LIST_SERVERS, async () => {
      return this.mcpServerManager.listAvailableServers();
    });

    ipcMain.handle(
      IPC_CHANNELS.MCP_ADD_SERVER,
      async (_event: IpcMainInvokeEvent, config: MCPServerConfig) => {
        await this.mcpServerManager.addServerAsync(config);
        return { success: true };
      },
    );

    ipcMain.handle(
      IPC_CHANNELS.MCP_UPDATE_SERVER,
      async (_event: IpcMainInvokeEvent, name: string, config: MCPServerConfig) => {
        await this.mcpServerManager.updateServerAsync(name, config);
        return { success: true };
      },
    );

    ipcMain.handle(
      IPC_CHANNELS.MCP_REMOVE_SERVER,
      async (_event: IpcMainInvokeEvent, name: string) => {
        await this.mcpServerManager.removeServerAsync(name);
        return { success: true };
      },
    );

    ipcMain.handle(
      IPC_CHANNELS.MCP_CHECK_SERVER_HEALTH,
      async (_event: IpcMainInvokeEvent, name: string) => {
        return await this.mcpServerManager.checkServerHealthAsync(name);
      },
    );

    ipcMain.handle(
      IPC_CHANNELS.MCP_LIST_SERVER_TOOLS,
      async (_event: IpcMainInvokeEvent, name: string) => {
        const client = await this.mcpServerManager.getMcpClientAsync(name);
        if (!client) {
          return [] as MCPToolSummary[];
        }
        const raw = await client.listToolsAsync();
        if (Array.isArray(raw)) {
          return (raw as unknown[])
            .map((tool) => ({
              name: (tool as { name?: string }).name ?? "",
              description: (tool as { description?: string }).description,
            }))
            .filter((summary) => typeof summary.name === "string" && summary.name.length > 0);
        }
        if (raw && typeof raw === "object") {
          const obj = raw as Record<string, unknown>;
          return Object.entries(obj).map(([name, value]) => ({
            name,
            description:
              value &&
              typeof value === "object" &&
              "description" in (value as { description?: string })
                ? (value as { description?: string }).description
                : undefined,
          }));
        }
        return [] as MCPToolSummary[];
      },
    );

    ipcMain.handle(
      IPC_CHANNELS.MCP_PROCESS_MESSAGE,
      async (
        _event: IpcMainInvokeEvent,
        prompt: string,
        videoUploadResult?: VideoUploadResult,
        options?: ProcessMessageOptions,
      ) => {
        const orchestrator = await MCPOrchestrator.getInstanceAsync();
        return await orchestrator.manualLoopAsync(prompt, videoUploadResult, options);
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
