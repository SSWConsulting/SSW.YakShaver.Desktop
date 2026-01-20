import type { MCPStep } from "./mcp";

export interface VideoProcessingPayload {
  transcriptText?: string;
  intermediateOutput?: unknown;
  steps?: MCPStep[];
}

export interface ExecutingTaskPayload extends VideoProcessingPayload {
  mcpResult?: string;
}
