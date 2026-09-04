import type { ToolApprovalDecision } from "./mcp";

export type InteractionType = "tool_approval" | "confirmation" | "input" | "project_selection";

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

export interface ProjectSelectionPayload {
  selectedProject: {
    id: string;
    name: string;
    description?: string;
    reason: string;
    source?: "local" | "remote";
  };
  allProjects: {
    id: string;
    name: string;
    description?: string;
    source?: "local" | "remote";
  }[];
}

/**
 * What the user did with the project/prompt confirmation dialog.
 *
 * `stop` is the dialog's Stop button: the user aborted the whole run rather than picking a
 * prompt, so the workflow must end instead of silently continuing with the AI's suggestion.
 */
export type ProjectSelectionResponse = { kind: "select"; projectId: string } | { kind: "stop" };

// Re-export decision type for convenience
export type { ToolApprovalDecision };
