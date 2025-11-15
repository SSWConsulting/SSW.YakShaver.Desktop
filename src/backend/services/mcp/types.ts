export type TransportType = "streamableHttp" | "stdio" | "inMemory";

export type MCPServerConfig = {
  name: string;
  description?: string;
  transport: TransportType;
  url?: string; // For HTTP-based transports
  headers?: Record<string, string>;
  command?: string; // For stdio transports
  args?: string[];
  env?: Record<string, string>;
  version?: string;
  timeoutMs?: number;
  enabled?: boolean;
  /**
   * Internal ID used to locate an in-memory transport instance.
   * Only set for built-in servers.
   */
  inMemoryServerId?: string;
  /**
   * Indicates this server is bundled with YakShaver and cannot be edited in the UI.
   */
  builtin?: boolean;
};
