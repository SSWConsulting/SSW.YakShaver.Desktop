import type { MCPStep } from "../../../shared/types/mcp";
import { ProgressStage as WorkflowProgressStage } from "../../../shared/types/workflow";
import type {
  ExecutingTaskPayload,
  OrchestratorBackend,
} from "../../../shared/types/workflow-payloads";
import type { WorkflowStateManager } from "./workflow-state-manager";

export class McpWorkflowAdapter {
  private steps: MCPStep[] = [];
  private workflowManager: WorkflowStateManager;
  /**
   * Set once this adapter's run has been superseded (e.g. by `runManualLoopWithTimeout` timing
   * out — #698). The underlying orchestrator call (`MCPOrchestrator` doesn't honour cancellation)
   * may keep running detached after that point; without this guard its late `onStep`/`complete`/
   * `fail` calls would still write into the SAME `WorkflowStateManager` instance (managers are
   * cached per shaveId and reused across retries), silently resurrecting or corrupting whatever
   * the next attempt for this shave has since written to the EXECUTING_TASK stage.
   */
  private discarded = false;

  constructor(
    workflowManager: WorkflowStateManager,
    initialContext?: {
      transcriptText?: string;
      intermediateOutput?: unknown;
      orchestrator?: OrchestratorBackend;
    },
  ) {
    this.workflowManager = workflowManager;

    // Initialize payload with context and empty steps
    if (initialContext) {
      this.updatePayload({
        ...initialContext,
        steps: [],
      });
    }
  }

  /**
   * Stops this adapter from writing to the workflow state any further. Call this when the run it
   * was tracking has been abandoned (timed out) so any late, detached completion can't clobber a
   * subsequent retry's state for the same stage.
   */
  public discard(): void {
    this.discarded = true;
  }

  public onStep = (step: MCPStep): void => {
    if (this.discarded) return;
    this.steps.push(step);
    this.updatePayload({ steps: this.steps });
  };

  private getPayload(): ExecutingTaskPayload {
    const rawPayload = this.workflowManager.getStepState(
      WorkflowProgressStage.EXECUTING_TASK,
    ).payload;
    if (!rawPayload) return { steps: [] };

    try {
      return JSON.parse(rawPayload) as ExecutingTaskPayload;
    } catch {
      return { steps: [] };
    }
  }

  private updatePayload(update: Partial<ExecutingTaskPayload>) {
    const current = this.getPayload();
    const newPayload = { ...current, ...update };
    // Maintain in_progress status while updating steps
    this.workflowManager.updateStagePayload(
      WorkflowProgressStage.EXECUTING_TASK,
      newPayload,
      "in_progress",
    );
  }

  public complete(finalResult: unknown, finalOutput?: string) {
    if (this.discarded) return;
    const payload = {
      ...this.getPayload(),
      mcpResult: typeof finalResult === "string" ? finalResult : JSON.stringify(finalResult),
      finalOutput,
    };
    this.workflowManager.completeStage(WorkflowProgressStage.EXECUTING_TASK, payload);
  }

  /**
   * Marks the Executing Task stage as failed while preserving the drafted result so the user
   * can still see what the model produced. Used when the loop finished but never actually
   * created a backlog item (#833).
   */
  public fail(finalResult: unknown, finalOutput: string | undefined, errorMessage: string) {
    if (this.discarded) return;
    // Snapshot the streamed steps + orchestrator badge BEFORE failStage() clobbers the payload:
    // failStage records the error + telemetry but REPLACES the stage payload with just { error }.
    const existing = this.getPayload();
    this.workflowManager.failStage(WorkflowProgressStage.EXECUTING_TASK, errorMessage);
    // Re-attach the snapshotted result afterwards (keeping the failed status and the error) so the
    // user can still see the streamed steps, the orchestrator badge, and what the model produced.
    const payload = {
      ...existing,
      error: errorMessage,
      mcpResult: typeof finalResult === "string" ? finalResult : JSON.stringify(finalResult),
      finalOutput,
    };
    this.workflowManager.updateStagePayload(
      WorkflowProgressStage.EXECUTING_TASK,
      payload,
      "failed",
    );
  }
}
