export type MCPServerConfig = {
  name: string;
  description?: string;
  transport: "streamableHttp" | "stdio";
  url: string; // For HTTP-based transports
  headers?: Record<string, string>;
  version?: string;
  timeoutMs?: number;
};

export type MCPAiMode = "yolo" | "warn" | "ask_first";

export interface MCPToolWhitelistEntry {
  id: string;
  serverName: string;
  toolName: string;
  createdAt: number;
}

export interface MCPToolControlSettings {
  mode: MCPAiMode;
  whitelist: MCPToolWhitelistEntry[];
}