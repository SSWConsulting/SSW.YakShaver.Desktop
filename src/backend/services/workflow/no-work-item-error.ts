import type { MCPTerminationReason } from "../mcp/mcp-orchestrator";

/**
 * Builds the user-facing error shown when the Executing Task stage finished but never actually
 * created a backlog item (#833), tailored to why the loop ended. Extracted as a pure function so
 * the message table is unit-testable without standing up the IPC handler.
 */
export function formatNoWorkItemError(reason: MCPTerminationReason): string {
  switch (reason) {
    case "length":
    case "max-iterations":
      return "The AI workflow ran out of room before it could finish creating a work item. No issue was created — please try again.";
    case "cancelled":
      return "Task execution was cancelled before a work item was created.";
    case "content-filter":
      return "The AI workflow was stopped by a content filter before a work item was created.";
    default:
      return "No work item was created. Your backlog connection (e.g. GitHub or Azure DevOps) may be signed out or unavailable — please reconnect and try again.";
  }
}
