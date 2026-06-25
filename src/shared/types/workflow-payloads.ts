import type { MCPStep } from "./mcp";

export interface VideoProcessingPayload {
  transcriptText?: string;
  intermediateOutput?: unknown;
  steps?: MCPStep[];
}

/** Which backend drives the Executing Task stage. Stamped at stage start so the UI can badge it. */
export type OrchestratorBackend = "openai" | "claude-code";

export interface ExecutingTaskPayload extends VideoProcessingPayload {
  mcpResult?: string;
  finalOutput?: string;
  /** The orchestrator that drove this stage. `claude-code` = local `claude -p`; `openai` = in-process loop. */
  orchestrator?: OrchestratorBackend;
  /** Populated when the stage failed (e.g. the loop never created a backlog item, #833). */
  error?: string;
}
