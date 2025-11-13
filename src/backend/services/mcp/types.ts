export type MCPServerConfig = {
  name: string;
  description?: string;
  transport: "streamableHttp" | "stdio";
  url?: string; // For HTTP-based transports
  headers?: Record<string, string>;
  command?: string; // For stdio transports
  args?: string[];
  env?: Record<string, string>;
  version?: string;
  timeoutMs?: number;
};
