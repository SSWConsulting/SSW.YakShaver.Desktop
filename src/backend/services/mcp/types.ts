import { IOType } from "child_process";
import Stream from "stream";

interface MCPBaseConfig {
  name: string;
  description?: string;
  transport: "streamableHttp" | "stdio";
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

export type MCPServerConfig = MCPHttpServerConfig | MCPStdioServerConfig;