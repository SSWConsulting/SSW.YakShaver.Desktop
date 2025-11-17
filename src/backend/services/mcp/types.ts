import { IOType } from "child_process";
import Stream from "stream";

export type MCPTransport = "streamableHttp" | "stdio";

export interface MCPServerConfig {
  name: string;
  description?: string;
  transport: MCPTransport;
  url?: string;
  headers?: Record<string, string>;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  version?: string;
  timeoutMs?: number;
  enabled?: boolean;
  stderr?: IOType | Stream | number;
  cwd?: string;
}

export function assertHttpServerConfig(
  config: MCPServerConfig,
): asserts config is MCPServerConfig & { transport: "streamableHttp"; url: string } {
  if (config.transport !== "streamableHttp") {
    throw new Error("Expected streamableHttp transport");
  }
  if (!config.url?.trim()) {
    throw new Error(`MCP server '${config.name}' is missing a URL for streamableHttp transport`);
  }
  try {
    new URL(config.url);
  } catch {
    throw new Error(`MCP server '${config.name}' has an invalid URL`);
  }
}

export function assertStdioServerConfig(
  config: MCPServerConfig,
): asserts config is MCPServerConfig & { transport: "stdio"; command: string } {
  if (config.transport !== "stdio") {
    throw new Error("Expected stdio transport");
  }
  if (!config.command?.trim()) {
    throw new Error(`MCP server '${config.name}' is missing a command for stdio transport`);
  }
}

export function validateMcpTransportConfig(config: MCPServerConfig): void {
  if (config.transport === "streamableHttp") {
    assertHttpServerConfig(config);
    return;
  }

  if (config.transport === "stdio") {
    assertStdioServerConfig(config);
    return;
  }

  throw new Error(`Unsupported transport: ${config.transport}`);
}
