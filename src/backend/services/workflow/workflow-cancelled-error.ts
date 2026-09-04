/**
 * User-facing message for a run the user stopped themselves. Phrased as an outcome rather
 * than a fault: nothing went wrong, the user simply ended the run from a dialog's Stop button.
 */
export const WORKFLOW_STOPPED_BY_USER_MESSAGE =
  "You stopped this run before a work item was created.";

/**
 * Thrown when the user aborts an in-flight workflow from one of the interaction dialogs
 * (project/prompt confirmation, tool approval).
 *
 * Callers distinguish this from a genuine failure so the stop is not reported to telemetry
 * as an error — the stage is still marked failed so the run visibly ends and stays retryable.
 */
export class WorkflowCancelledError extends Error {
  constructor(message: string = WORKFLOW_STOPPED_BY_USER_MESSAGE) {
    super(message);
    this.name = "WorkflowCancelledError";
  }
}
