import type { MCPTerminationReason } from "../mcp/mcp-orchestrator";

/**
 * Builds the user-facing error shown when the Executing Task stage finished but never actually
 * created a backlog item (#833), tailored to why the loop ended. Extracted as a pure function so
 * the message table is unit-testable without standing up the IPC handler.
 */
export function formatNoWorkItemError(
  reason: MCPTerminationReason,
  options: { verificationUnavailable?: boolean } = {},
): string {
  // A tool succeeded but there was no judge model to confirm it. The item MAY exist, so we must
  // NOT claim "nothing was created / your connection is signed out" — that's actively false and
  // tends to make the user re-run and file a duplicate. Tell them to verify before retrying.
  if (options.verificationUnavailable) {
    return "Claude Code may have created a work item, but it could not be verified because no OpenAI/Azure language model is configured. Configure a language model in Settings to confirm success — and check your backlog before re-running to avoid creating a duplicate.";
  }

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
