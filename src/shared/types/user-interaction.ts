import type { ToolApprovalDecision } from "./mcp";

export type InteractionType = "tool_approval" | "confirmation" | "input";

export interface InteractionRequest<T = unknown> {
  requestId: string;
  type: InteractionType;
  payload: T;
  autoApproveAt?: number;
  message?: string;
}

export interface InteractionResponse<T = unknown> {
  requestId: string;
  data: T;
}

export interface ToolApprovalPayload {
  toolName: string;
  args: unknown;
}

// Re-export decision type for convenience
export type { ToolApprovalDecision };
