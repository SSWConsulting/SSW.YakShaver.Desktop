import { randomUUID } from "node:crypto";
import { BrowserWindow, ipcMain } from "electron";
import { IPC_CHANNELS } from "../../ipc/channels";
import type {
  MCPAiMode,
  MCPToolControlSettings,
  MCPToolWhitelistEntry,
} from "./types";
import { McpToolControlStorage } from "../storage/mcp-tool-control-storage";

export interface ToolCallContext {
  toolId: string;
  serverName: string;
  toolName: string;
  args: Record<string, unknown>;
}

interface RendererPermissionResponse {
  requestId: string;
  decision: "accept_once" | "always_accept" | "reject";
  feedback?: string;
}

interface ToolPermissionRequestPayload {
  requestId: string;
  mode: Exclude<MCPAiMode, "yolo">;
  toolId: string;
  serverName: string;
  toolName: string;
  args: Record<string, unknown>;
  requestedAt: number;
  timeoutMs?: number;
}

interface PendingRequest {
  resolve: (response: RendererPermissionResponse) => void;
  timeoutHandle?: NodeJS.Timeout;
}

const WARN_TIMEOUT_MS = 15_000;

export interface ToolPermissionOutcome {
  allowed: boolean;
  userFeedback?: string;
  addedToWhitelist?: boolean;
}

export class McpToolControlService {
  private static instance: McpToolControlService;

  private storage = McpToolControlStorage.getInstance();
  private settingsCache: MCPToolControlSettings | null = null;
  private pendingRequests = new Map<string, PendingRequest>();

  private constructor() {
    ipcMain.on(
      IPC_CHANNELS.MCP_TOOL_PERMISSION_RESPONSE,
      (_event, payload: RendererPermissionResponse) => {
        this.resolvePendingRequest(payload);
      },
    );
  }

  static getInstance(): McpToolControlService {
    if (!McpToolControlService.instance) {
      McpToolControlService.instance = new McpToolControlService();
    }
    return McpToolControlService.instance;
  }

  private async loadSettings(): Promise<MCPToolControlSettings> {
    if (this.settingsCache) return this.settingsCache;
    const settings = await this.storage.getSettings();
    this.settingsCache = settings;
    return settings;
  }

  private async persistSettings(settings: MCPToolControlSettings): Promise<MCPToolControlSettings> {
    this.settingsCache = settings;
    await this.storage.saveSettings(settings);
    return settings;
  }

  async getSettings(): Promise<MCPToolControlSettings> {
    const settings = await this.loadSettings();
    return {
      mode: settings.mode,
      whitelist: [...settings.whitelist],
    };
  }

  async setMode(mode: MCPAiMode): Promise<MCPToolControlSettings> {
    const settings = await this.loadSettings();
    if (settings.mode === mode) return this.getSettings();
    const next: MCPToolControlSettings = {
      ...settings,
      mode,
    };
    await this.persistSettings(next);
    return this.getSettings();
  }

  async removeWhitelistEntry(id: string): Promise<MCPToolControlSettings> {
    const settings = await this.loadSettings();
    const next: MCPToolControlSettings = {
      ...settings,
      whitelist: settings.whitelist.filter((entry) => entry.id !== id),
    };
    await this.persistSettings(next);
    return this.getSettings();
  }

  private async addWhitelistEntry(entry: MCPToolWhitelistEntry): Promise<void> {
    const settings = await this.loadSettings();
    const exists = settings.whitelist.some((item) => item.id === entry.id);
    if (exists) return;
    settings.whitelist.push(entry);
    await this.persistSettings({
      ...settings,
      whitelist: settings.whitelist,
    });
  }

  private isWhitelisted(toolId: string, settings: MCPToolControlSettings): boolean {
    return settings.whitelist.some((entry) => entry.id === toolId);
  }

  async ensureToolPermission(context: ToolCallContext): Promise<ToolPermissionOutcome> {
    const settings = await this.loadSettings();
    if (this.isWhitelisted(context.toolId, settings)) {
      return { allowed: true };
    }

    if (settings.mode === "yolo") {
      return { allowed: true };
    }

    if (!this.hasRenderableWindow()) {
      return { allowed: true };
    }

    const result = await this.requestRendererApproval(context, settings.mode);
    if (result.decision === "always_accept") {
      await this.addWhitelistEntry({
        id: context.toolId,
        serverName: context.serverName,
        toolName: context.toolName,
        createdAt: Date.now(),
      });
      return { allowed: true, addedToWhitelist: true };
    }
    if (result.decision === "accept_once") {
      return { allowed: true };
    }
    return {
      allowed: false,
      userFeedback: result.feedback,
    };
  }

  private hasRenderableWindow(): boolean {
    return BrowserWindow.getAllWindows().some((win) => !win.isDestroyed());
  }

  private async requestRendererApproval(
    context: ToolCallContext,
    mode: Exclude<MCPAiMode, "yolo">,
  ): Promise<RendererPermissionResponse> {
    const requestId = randomUUID();
    const payload: ToolPermissionRequestPayload = {
      requestId,
      mode,
      toolId: context.toolId,
      serverName: context.serverName,
      toolName: context.toolName,
      args: context.args,
      requestedAt: Date.now(),
      timeoutMs: mode === "warn" ? WARN_TIMEOUT_MS : undefined,
    };

    const responsePromise = new Promise<RendererPermissionResponse>((resolve) => {
      const timeoutHandle =
        mode === "warn"
          ? setTimeout(() => {
              this.resolvePendingRequest({
                requestId,
                decision: "accept_once",
              });
            }, WARN_TIMEOUT_MS)
          : undefined;
      this.pendingRequests.set(requestId, { resolve, timeoutHandle });
    });

    this.broadcastPermissionRequest(payload);
    return responsePromise;
  }

  private broadcastPermissionRequest(payload: ToolPermissionRequestPayload): void {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send(IPC_CHANNELS.MCP_TOOL_PERMISSION_REQUEST, payload);
      }
    }
  }

  private resolvePendingRequest(response: RendererPermissionResponse): void {
    const pending = this.pendingRequests.get(response.requestId);
    if (!pending) return;
    this.pendingRequests.delete(response.requestId);
    if (pending.timeoutHandle) {
      clearTimeout(pending.timeoutHandle);
    }
    pending.resolve(response);
    this.broadcastPermissionResolution(response);
  }

  private broadcastPermissionResolution(response: RendererPermissionResponse): void {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send(IPC_CHANNELS.MCP_TOOL_PERMISSION_RESOLVED, response);
      }
    }
  }
}

