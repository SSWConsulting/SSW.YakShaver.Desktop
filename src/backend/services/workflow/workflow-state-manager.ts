import { BrowserWindow } from "electron";
import { IPC_CHANNELS } from "../../ipc/channels";
// import { IPC_CHANNELS } from "../../preload";
import {
  ProgressStage,
  WorkflowState,
  WorkflowStatus,
  type WorkflowStep,
} from "../../../shared/types/workflow";
export class WorkflowStateManager {
  private shaveId: string;
  private state: WorkflowState;

  public constructor(shaveId?: string) {
    // assign a GUID ID to this workflow instance
    this.shaveId = shaveId ?? crypto.randomUUID();
    this.state = this.initiateStates();
  }

  private initiateStates(): WorkflowState {
    const createStep = (stage: ProgressStage): WorkflowStep => ({
      stage,
      status: "not_started",
    });

    return {
      uploading_video: createStep(ProgressStage.UPLOADING_VIDEO),
      downloading_video: createStep(ProgressStage.DOWNLOADING_VIDEO),
      converting_audio: createStep(ProgressStage.CONVERTING_AUDIO),
      transcribing: createStep(ProgressStage.TRANSCRIBING),
      analyzing_transcript: createStep(ProgressStage.ANALYZING_TRANSCRIPT),
      executing_task: createStep(ProgressStage.EXECUTING_TASK),
      updating_metadata: createStep(ProgressStage.UPDATING_METADATA),
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
  public completeStage(stageKey: keyof WorkflowState, payload?: any) {
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
   * Sets status to 'failed' and updates the global error state.
   */
  public failStage(stageKey: keyof WorkflowState, error: string | Error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    this.state[stageKey] = {
      ...this.state[stageKey],
      status: "failed",
      payload: JSON.stringify({ error: errorMessage }),
    };
    this.broadcast();
  }

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
