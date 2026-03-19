/**
 * Fault Injection for Workflow Testing
 *
 * Enable via environment variable:
 *   WORKFLOW_FAIL_AT_STAGE=converting_audio
 *
 * Valid stage values (matches ProgressStage enum):
 *   - uploading_video
 *   - downloading_video
 *   - converting_audio
 *   - transcribing
 *   - analyzing_transcript
 *   - selecting_prompt
 *   - executing_task
 *   - updating_metadata
 *
 * Usage:
 *   1. Set env var before launching the app:
 *        $env:WORKFLOW_FAIL_AT_STAGE="converting_audio"  # PowerShell
 *        WORKFLOW_FAIL_AT_STAGE=converting_audio          # bash
 *
 *   2. Or call FaultInjection.setFailAtStage("converting_audio") from dev tools / test code
 *
 *   3. Run a normal video workflow — it will execute all stages up to the target,
 *      save real checkpoints, then throw a simulated error at the target stage.
 *
 *   4. The retry panel should appear, allowing you to retry from the failed stage
 *      with all prior checkpoint data intact.
 *
 *   5. To clear: FaultInjection.clear() or unset the env var.
 */

import type { WorkflowState } from "../../../shared/types/workflow";
import type { WorkflowStateManager } from "./workflow-state-manager";

const VALID_STAGES: (keyof WorkflowState)[] = [
  "uploading_video",
  "downloading_video",
  "converting_audio",
  "transcribing",
  "analyzing_transcript",
  "selecting_prompt",
  "executing_task",
  "updating_metadata",
];

let _failAtStage: keyof WorkflowState | null = null;
let _failOnRetry = false;

function setFailAtStage(stage: keyof WorkflowState | null): void {
  if (stage && !VALID_STAGES.includes(stage)) {
    console.warn(
      `[FaultInjection] Invalid stage "${stage}". Valid stages: ${VALID_STAGES.join(", ")}`,
    );
    return;
  }
  _failAtStage = stage;
  console.log(
    `[FaultInjection] ${stage ? `Will fail at stage: ${stage}` : "Cleared — no fault injection"}`,
  );
}

function setFailOnRetry(value: boolean): void {
  _failOnRetry = value;
  console.log(`[FaultInjection] Fail on retry: ${value}`);
}

function clear(): void {
  _failAtStage = null;
  _failOnRetry = false;
  console.log("[FaultInjection] All fault injection cleared");
}

function getFailAtStage(): keyof WorkflowState | null {
  if (_failAtStage) {
    return _failAtStage;
  }

  const envStage = process.env.WORKFLOW_FAIL_AT_STAGE;
  if (envStage && VALID_STAGES.includes(envStage as keyof WorkflowState)) {
    return envStage as keyof WorkflowState;
  }

  return null;
}

function shouldFail(currentStage: keyof WorkflowState, isRetry = false): boolean {
  const targetStage = getFailAtStage();
  if (!targetStage) return false;
  if (currentStage !== targetStage) return false;
  if (isRetry && !_failOnRetry) return false;
  return true;
}

/**
 * Call at the START of each stage. If this stage matches the fault injection target,
 * marks it as failed on the workflowManager and throws a simulated error.
 */
function checkAndThrow(
  currentStage: keyof WorkflowState,
  workflowManager?: WorkflowStateManager,
  isRetry = false,
): void {
  if (!shouldFail(currentStage, isRetry)) return;

  const errorMessage =
    `[FaultInjection] Simulated failure at stage "${currentStage}". ` +
    `This is a test error for retry testing. ` +
    `Clear with FaultInjection.clear() or unset WORKFLOW_FAIL_AT_STAGE.`;

  console.error(errorMessage);

  if (workflowManager) {
    workflowManager.failStage(currentStage, errorMessage);
  }

  throw new Error(errorMessage);
}

function getStatus(): {
  failAtStage: string | null;
  failOnRetry: boolean;
  envVar: string | undefined;
} {
  return {
    failAtStage: _failAtStage,
    failOnRetry: _failOnRetry,
    envVar: process.env.WORKFLOW_FAIL_AT_STAGE,
  };
}

export const FaultInjection = {
  setFailAtStage,
  setFailOnRetry,
  clear,
  getFailAtStage,
  shouldFail,
  checkAndThrow,
  getStatus,
};
