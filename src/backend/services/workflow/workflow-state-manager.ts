import { BrowserWindow } from "electron";
import { IPC_CHANNELS } from "../../ipc/channels";
import { formatErrorMessage } from "../../utils/error-utils";
import {
  ProgressStage,
  type WorkflowState,
  type WorkflowStatus,
  type WorkflowStep,
} from "../../../shared/types/workflow";
export class WorkflowStateManager {
  private shaveId: string;
  private state: WorkflowState;

  public constructor(shaveId?: string) {
    this.shaveId = shaveId ?? crypto.randomUUID();
    this.state = this.initiateStates();
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
    this.broadcast();
  }

  /**
   * Start a specific stage in the workflow.
   * Sets status to 'in_progress' and records start time.
   */
  public startStage(stageKey: keyof WorkflowState) {
    this.state[stageKey] = {
      ...this.state[stageKey],
      status: "in_progress",
      createdAt: Date.now(),
    };

    this.broadcast();
  }

  /**
   * Complete a specific stage in the workflow.
   * Sets status to 'completed' and attaches payload.
   */
  public completeStage(stageKey: keyof WorkflowState, payload?: unknown) {
    this.state[stageKey] = {
      ...this.state[stageKey],
      status: "completed",
      payload: payload ? JSON.stringify(payload) : undefined,
    };
    this.broadcast();
  }

  public skipStage(stageKey: keyof WorkflowState) {
    this.state[stageKey] = {
      ...this.state[stageKey],
      status: "skipped",
    };
    this.broadcast();
  }

  /**
   * Fail a specific stage in the workflow.
   */
  public failStage(stageKey: keyof WorkflowState, error: string | Error) {
    const errorMessage = formatErrorMessage(error);

    this.state[stageKey] = {
      ...this.state[stageKey],
      status: "failed",
      payload: JSON.stringify({ error: errorMessage }),
    };
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
