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
  };
  allProjects: {
    id: string;
    name: string;
    description?: string;
  }[];
}

export interface ProjectSelectionResponse {
  projectId: string;
  // name?: string; // Optional if we just return ID
}

// Re-export decision type for convenience
export type { ToolApprovalDecision };
