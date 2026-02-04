export type StepType =
  | "start"
  | "reasoning"
  | "tool_call"
  | "tool_result"
  | "final_result"
  | "tool_approval_required"
  | "tool_denied";

export type ToolApprovalDecision =
  | { kind: "approve" }
  | { kind: "deny_stop"; feedback?: string }
  | { kind: "request_changes"; feedback: string };

export interface MCPStep {
  type: StepType;
  message?: string;
  reasoning?: string;
  toolName?: string;
  serverName?: string;
  args?: unknown;
  result?: unknown;
  error?: string;
  requestId?: string;
  timestamp?: number;
  autoApproveAt?: number;
}

export type Transport = "streamableHttp" | "stdio" | "inMemory";

export interface MCPBaseConfig {
  id: string;
  name: string;
  description?: string;
  transport: Transport;
  builtin?: boolean; // True for internal/built-in servers
  toolWhitelist?: string[];
  enabled?: boolean;
}

export interface MCPHttpServerConfig extends MCPBaseConfig {
  transport: "streamableHttp";
  url: string; // For HTTP-based transports
  headers?: Record<string, string>;
  version?: string;
  timeoutMs?: number;
}

export interface MCPStdioServerConfig extends MCPBaseConfig {
  transport: "stdio";
  command: string; // For stdio transport
  args?: string[];
  env?: Record<string, string>;
  stderr?: "inherit" | "ignore" | "pipe";
  cwd?: string;
}

export interface MCPInMemoryServerConfig extends MCPBaseConfig {
  transport: "inMemory";
  inMemoryServerId?: string; // Identifier for the in-memory server implementation
  builtin?: true;
}

export type MCPServerConfig = MCPHttpServerConfig | MCPStdioServerConfig | MCPInMemoryServerConfig;

export interface MCPToolSummary {
  name: string;
  description?: string;
}
