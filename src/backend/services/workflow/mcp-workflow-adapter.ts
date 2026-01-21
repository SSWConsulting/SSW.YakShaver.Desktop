import type { MCPStep } from "../../../shared/types/mcp";
import { ProgressStage as WorkflowProgressStage } from "../../../shared/types/workflow";
import type { ExecutingTaskPayload } from "../../../shared/types/workflow-payloads";
import type { WorkflowStateManager } from "./workflow-state-manager";

export class McpWorkflowAdapter {
  private steps: MCPStep[] = [];
  private workflowManager: WorkflowStateManager;

  constructor(
    workflowManager: WorkflowStateManager,
    initialContext?: { transcriptText?: string; intermediateOutput?: unknown },
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

  public onStep = (step: MCPStep): void => {
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

  public complete(finalResult: unknown) {
    const payload = {
      ...this.getPayload(),
      mcpResult: typeof finalResult === "string" ? finalResult : JSON.stringify(finalResult),
    };
    this.workflowManager.updateStagePayload(
      WorkflowProgressStage.EXECUTING_TASK,
      payload,
      "completed",
    );
  }
}
