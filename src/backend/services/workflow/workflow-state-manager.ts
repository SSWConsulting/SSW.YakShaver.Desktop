import { BrowserWindow } from "electron";
import {
  ProgressStage,
  type WorkflowState,
  type WorkflowStatus,
  type WorkflowStep,
} from "../../../shared/types/workflow";
import { IPC_CHANNELS } from "../../ipc/channels";
import { formatErrorMessage } from "../../utils/error-utils";
import { TelemetryService } from "../telemetry/telemetry-service";
import { type CheckpointData, WorkflowCheckpointService } from "./workflow-checkpoint-service";

export class WorkflowStateManager {
  private shaveId: string;
  private state: WorkflowState;
  private telemetryService: TelemetryService;
  private checkpointService: WorkflowCheckpointService;
  private stageStartTimes: Map<string, number> = new Map();

  public constructor(shaveId?: string) {
    this.shaveId = shaveId ?? crypto.randomUUID();
    this.state = this.initiateStates();
    this.telemetryService = TelemetryService.getInstance();
    this.checkpointService = WorkflowCheckpointService.getInstance();
  }

  private initiateStates(): WorkflowState {
    const createStep = (stage: ProgressStage): WorkflowStep => ({
      stage,
      status: "not_started",
    });

    return {
      [ProgressStage.UPLOADING_VIDEO]: createStep(ProgressStage.UPLOADING_VIDEO),
      [ProgressStage.DOWNLOADING_VIDEO]: createStep(ProgressStage.DOWNLOADING_VIDEO),
      [ProgressStage.CONVERTING_AUDIO]: createStep(ProgressStage.CONVERTING_AUDIO),
      [ProgressStage.TRANSCRIBING]: createStep(ProgressStage.TRANSCRIBING),
      [ProgressStage.ANALYZING_TRANSCRIPT]: createStep(ProgressStage.ANALYZING_TRANSCRIPT),
      [ProgressStage.SELECTING_PROMPT]: createStep(ProgressStage.SELECTING_PROMPT),
      [ProgressStage.EXECUTING_TASK]: createStep(ProgressStage.EXECUTING_TASK),
      [ProgressStage.UPDATING_METADATA]: createStep(ProgressStage.UPDATING_METADATA),
    };
  }

  public getState(): WorkflowState {
    return JSON.parse(JSON.stringify(this.state));
  }

  public getStepState(stageKey: keyof WorkflowState): WorkflowStep {
    return this.state[stageKey];
  }

  public getWorkflowId(): string {
    return this.shaveId;
  }

  public reset() {
    this.state = this.initiateStates();
    this.checkpointService.clearAll(this.shaveId);
    this.broadcast();
  }

  /**
   * Prepare a stage for retry by resetting it and all subsequent stages.
   */
  public prepareStageForRetry(stageKey: keyof WorkflowState): boolean {
    this.checkpointService.incrementRetryCount(this.shaveId, stageKey);

    // Get the ordered list of stages
    const stageKeys: (keyof WorkflowState)[] = [
      ProgressStage.UPLOADING_VIDEO,
      ProgressStage.DOWNLOADING_VIDEO,
      ProgressStage.CONVERTING_AUDIO,
      ProgressStage.TRANSCRIBING,
      ProgressStage.ANALYZING_TRANSCRIPT,
      ProgressStage.SELECTING_PROMPT,
      ProgressStage.EXECUTING_TASK,
      ProgressStage.UPDATING_METADATA,
    ];

    const stageIndex = stageKeys.indexOf(stageKey);
    if (stageIndex === -1) {
      return false;
    }

    // Reset current and all subsequent stages to "not_started"
    for (let i = stageIndex; i < stageKeys.length; i++) {
      const key = stageKeys[i];
      // Keep prior stages as completed, reset current and later ones
      if (this.state[key].status !== "skipped") {
        this.state[key] = {
          ...this.state[key],
          status: "not_started",
          payload: undefined,
        };
      }
    }

    this.telemetryService.trackEvent({
      name: "WorkflowStageRetryInitiated",
      properties: {
        workflowId: this.shaveId,
        stage: stageKey as string,
        attemptNumber: this.getRetryCount(stageKey),
      },
    });

    this.broadcast();
    return true;
  }

  /**
   * Get the number of retry attempts for a stage.
   */
  public getRetryCount(stageKey: keyof WorkflowState): number {
    return this.checkpointService.getRetryCount(this.shaveId, stageKey);
  }

  /**
   * Get retry status including count and whether max is reached.
   */
  public getRetryStatus(stageKey: keyof WorkflowState) {
    const stepState = this.getStepState(stageKey);
    const lastError =
      stepState.status === "failed" && stepState.payload
        ? (JSON.parse(stepState.payload).error as string)
        : undefined;

    return this.checkpointService.getRetryStatus(this.shaveId, stageKey, lastError);
  }

  /**
   * Check if a stage can be retried.
   */
  public canRetry(stageKey: keyof WorkflowState): boolean {
    const stepState = this.getStepState(stageKey);
    return stepState.status === "failed";
  }

  /**
   * Create a checkpoint for a stage with its data.
   */
  public createCheckpoint(stageKey: keyof WorkflowState, data: CheckpointData): void {
    this.checkpointService.createCheckpoint(this.shaveId, stageKey, data);
  }

  /**
   * Get checkpoint data for a stage.
   */
  public getCheckpoint(stageKey: keyof WorkflowState): CheckpointData | undefined {
    return this.checkpointService.getCheckpoint(this.shaveId, stageKey);
  }

  /**
   * Get all checkpoints for this workflow.
   */
  public getAllCheckpoints(): Map<keyof WorkflowState, CheckpointData> {
    return this.checkpointService.getAllCheckpoints(this.shaveId);
  }

  /**
   * Clear all checkpoints and retry counts for this workflow.
   */
  public clearAllCheckpoints(): void {
    this.checkpointService.clearAll(this.shaveId);
  }

  /**
   * Get all failed stages that can be retried.
   */
  public getRetryableFailedStages(): Array<{
    stage: keyof WorkflowState;
    retryCount: number;
    maxReached: boolean;
    lastError?: string;
  }> {
    const failed: Array<{
      stage: keyof WorkflowState;
      retryCount: number;
      maxReached: boolean;
      lastError?: string;
    }> = [];

    const stageKeys: (keyof WorkflowState)[] = [
      ProgressStage.UPLOADING_VIDEO,
      ProgressStage.DOWNLOADING_VIDEO,
      ProgressStage.CONVERTING_AUDIO,
      ProgressStage.TRANSCRIBING,
      ProgressStage.ANALYZING_TRANSCRIPT,
      ProgressStage.SELECTING_PROMPT,
      ProgressStage.EXECUTING_TASK,
      ProgressStage.UPDATING_METADATA,
    ];

    for (const stage of stageKeys) {
      const stepState = this.getStepState(stage);
      if (stepState.status === "failed") {
        const status = this.getRetryStatus(stage);
        failed.push({
          stage,
          retryCount: status.count,
          maxReached: status.maxReached,
          lastError: status.lastError,
        });
      }
    }

    return failed;
  }

  /**
   * Start a specific stage in the workflow.
   * Sets status to 'in_progress' and records start time.
   */
  public startStage(stageKey: keyof WorkflowState) {
    const startTime = Date.now();
    this.stageStartTimes.set(stageKey as string, startTime);

    this.state[stageKey] = {
      ...this.state[stageKey],
      status: "in_progress",
      createdAt: startTime,
    };

    this.telemetryService.trackWorkflowStage({
      workflowId: this.shaveId,
      stage: stageKey as string,
      status: "started",
    });

    this.broadcast();
  }

  /**
   * Complete a specific stage in the workflow.
   * Sets status to 'completed' and attaches payload.
   */
  public completeStage(stageKey: keyof WorkflowState, payload?: unknown) {
    const startTime = this.stageStartTimes.get(stageKey as string);
    const duration = startTime ? Date.now() - startTime : undefined;

    this.state[stageKey] = {
      ...this.state[stageKey],
      status: "completed",
      payload: payload ? JSON.stringify(payload) : undefined,
    };

    this.telemetryService.trackWorkflowStage({
      workflowId: this.shaveId,
      stage: stageKey as string,
      status: "completed",
      duration,
    });

    this.broadcast();
  }

  public skipStage(stageKey: keyof WorkflowState) {
    const startTime = this.stageStartTimes.get(stageKey as string);
    const duration = startTime ? Date.now() - startTime : undefined;

    this.state[stageKey] = {
      ...this.state[stageKey],
      status: "skipped",
    };

    this.telemetryService.trackWorkflowStage({
      workflowId: this.shaveId,
      stage: stageKey as string,
      status: "skipped",
      duration,
    });

    this.broadcast();
  }

  /**
   * Fail a specific stage in the workflow.
   */
  public failStage(stageKey: keyof WorkflowState, error: string | Error) {
    const errorMessage = formatErrorMessage(error);
    const startTime = this.stageStartTimes.get(stageKey as string);
    const duration = startTime ? Date.now() - startTime : undefined;

    this.state[stageKey] = {
      ...this.state[stageKey],
      status: "failed",
      payload: JSON.stringify({
        error: errorMessage,
        retryCount: this.getRetryCount(stageKey),
      }),
    };

    this.telemetryService.trackWorkflowStage({
      workflowId: this.shaveId,
      stage: stageKey as string,
      status: "failed",
      duration,
      error: errorMessage,
    });

    this.telemetryService.trackError({
      error: error instanceof Error ? error : new Error(errorMessage),
      context: `workflow_stage_${stageKey as string}`,
      workflowId: this.shaveId,
      additionalProperties: {
        stage: stageKey as string,
        duration: duration?.toString() ?? "unknown",
        retryCount: this.getRetryCount(stageKey).toString(),
      },
    });

    this.broadcast();
  }

  // Append the payload and optionally status of a specific stage.
  public updateStagePayload(
    stageKey: keyof WorkflowState,
    payload?: unknown,
    WorkflowStatus?: WorkflowStatus,
  ) {
    this.state[stageKey] = {
      ...this.state[stageKey],
      payload: JSON.stringify(payload),
      status: WorkflowStatus ?? this.state[stageKey].status,
    };
    this.broadcast();
  }

  private broadcast() {
    // Send a copy to avoid mutation issues if any
    const stateToSend = this.getState();

    BrowserWindow.getAllWindows()
      .filter((win) => !win.isDestroyed())
      .forEach((win) => {
        win.webContents.send(IPC_CHANNELS.WORKFLOW_PROGRESS_NEO, stateToSend);
      });
  }
}
