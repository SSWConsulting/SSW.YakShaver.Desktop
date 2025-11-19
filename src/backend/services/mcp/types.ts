import type { IOType } from "node:child_process";
import type Stream from "node:stream";

interface MCPBaseConfig {
  name: string;
  description?: string;
  transport: "streamableHttp" | "stdio" | "inMemory";
}

interface MCPHttpServerConfig extends MCPBaseConfig {
  transport: "streamableHttp";
  url: string; // For HTTP-based transports
  headers?: Record<string, string>;
  version?: string;
  timeoutMs?: number;
}

interface MCPStdioServerConfig extends MCPBaseConfig {
  transport: "stdio";
  command: string; // For stdio transport
  args?: string[];
  env?: Record<string, string>;
  stderr?: IOType | Stream | number;
  cwd?: string;
}

interface MCPInMemoryServerConfig extends MCPBaseConfig {
  transport: "inMemory";
  inMemoryServerId: string; // Identifier for the in-memory server implementation
}

export type MCPServerConfig = MCPHttpServerConfig | MCPStdioServerConfig | MCPInMemoryServerConfig;
