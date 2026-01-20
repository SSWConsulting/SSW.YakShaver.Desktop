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
