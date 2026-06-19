import { ProgressStage, type WorkflowState, type WorkflowStatus } from "@shared/types/workflow";
import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FinalResultPanel } from "./FinalResultPanel";

// Capture the renderer-side workflow progress callback so the test can drive
// the panel through a full run and then a second run, exactly as the IPC bridge
// would at runtime.
const { onProgressNeo, onStepUpdate, progressCallbacks } = vi.hoisted(() => {
  const callbacks: ((data: unknown) => void)[] = [];
  return {
    progressCallbacks: callbacks,
    onProgressNeo: vi.fn((cb: (data: unknown) => void) => {
      callbacks.push(cb);
      return () => {};
    }),
    onStepUpdate: vi.fn(() => () => {}),
  };
});

vi.mock("@/services/ipc-client", () => ({
  ipcClient: {
    workflow: { onProgressNeo },
    mcp: { onStepUpdate },
  },
}));

const STAGES = [
  ProgressStage.UPLOADING_VIDEO,
  ProgressStage.DOWNLOADING_VIDEO,
  ProgressStage.CONVERTING_AUDIO,
  ProgressStage.TRANSCRIBING,
  ProgressStage.ANALYZING_TRANSCRIPT,
  ProgressStage.SELECTING_PROMPT,
  ProgressStage.EXECUTING_TASK,
  ProgressStage.UPDATING_METADATA,
] as const;

/** Build a WorkflowState with every stage set to `not_started`, then override. */
function buildState(overrides: Partial<Record<ProgressStage, WorkflowStatus>>): WorkflowState {
  const state = {} as WorkflowState;
  for (const stage of STAGES) {
    state[stage] = { stage, status: overrides[stage] ?? "not_started" };
  }
  return state;
}

function withExecutingPayload(state: WorkflowState, finalOutput: string): WorkflowState {
  state.executing_task = {
    stage: ProgressStage.EXECUTING_TASK,
    status: "completed",
    payload: JSON.stringify({ finalOutput }),
  };
  return state;
}

function emit(state: WorkflowState) {
  act(() => {
    for (const cb of progressCallbacks) {
      cb({ shaveId: "shave-1", state });
    }
  });
}

// A YouTube/external run: UPLOADING is skipped, DOWNLOADING runs first.
function completedYouTubeRun(finalOutput: string): WorkflowState {
  const state = buildState({
    [ProgressStage.UPLOADING_VIDEO]: "skipped",
    [ProgressStage.DOWNLOADING_VIDEO]: "completed",
    [ProgressStage.CONVERTING_AUDIO]: "completed",
    [ProgressStage.TRANSCRIBING]: "completed",
    [ProgressStage.ANALYZING_TRANSCRIPT]: "completed",
    [ProgressStage.SELECTING_PROMPT]: "completed",
    [ProgressStage.EXECUTING_TASK]: "completed",
    [ProgressStage.UPDATING_METADATA]: "completed",
  });
  return withExecutingPayload(state, finalOutput);
}

describe("FinalResultPanel — clears previous output on a new run (#754)", () => {
  beforeEach(() => {
    progressCallbacks.length = 0;
    onProgressNeo.mockClear();
    onStepUpdate.mockClear();
  });
  afterEach(() => vi.restoreAllMocks());

  it("clears the previous run's output the moment a new YouTube download starts, before new output arrives", () => {
    render(<FinalResultPanel />);

    // First run finishes and renders its final output.
    emit(completedYouTubeRun(JSON.stringify({ Status: "success", Title: "First run result" })));
    expect(screen.getByText(/First run result/)).toBeInTheDocument();

    // A new YouTube link is processed: DOWNLOADING_VIDEO becomes in_progress
    // while the video downloads — no new final output exists yet.
    emit(
      buildState({
        [ProgressStage.UPLOADING_VIDEO]: "skipped",
        [ProgressStage.DOWNLOADING_VIDEO]: "in_progress",
      }),
    );

    // The stale output from the previous run must be gone immediately, even
    // though the new run has produced no output yet (panel renders nothing).
    expect(screen.queryByText(/First run result/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Final Result/)).not.toBeInTheDocument();
  });

  it("still clears for the recording (upload) path", () => {
    render(<FinalResultPanel />);

    // First run finishes (recording path: UPLOADING ran, DOWNLOADING skipped).
    const firstRun = buildState({
      [ProgressStage.DOWNLOADING_VIDEO]: "skipped",
      [ProgressStage.UPLOADING_VIDEO]: "completed",
      [ProgressStage.CONVERTING_AUDIO]: "completed",
      [ProgressStage.TRANSCRIBING]: "completed",
      [ProgressStage.ANALYZING_TRANSCRIPT]: "completed",
      [ProgressStage.SELECTING_PROMPT]: "completed",
      [ProgressStage.EXECUTING_TASK]: "completed",
      [ProgressStage.UPDATING_METADATA]: "completed",
    });
    emit(
      withExecutingPayload(firstRun, JSON.stringify({ Status: "success", Title: "Recording A" })),
    );
    expect(screen.getByText(/Recording A/)).toBeInTheDocument();

    // New recording starts uploading — stale output clears immediately.
    emit(
      buildState({
        [ProgressStage.DOWNLOADING_VIDEO]: "skipped",
        [ProgressStage.UPLOADING_VIDEO]: "in_progress",
      }),
    );
    expect(screen.queryByText(/Recording A/)).not.toBeInTheDocument();
  });

  it("shows the new run's output once it completes", () => {
    render(<FinalResultPanel />);

    emit(completedYouTubeRun(JSON.stringify({ Status: "success", Title: "First run result" })));
    expect(screen.getByText(/First run result/)).toBeInTheDocument();

    // New download starts (clears), then the second run completes with new output.
    emit(
      buildState({
        [ProgressStage.UPLOADING_VIDEO]: "skipped",
        [ProgressStage.DOWNLOADING_VIDEO]: "in_progress",
      }),
    );
    expect(screen.queryByText(/First run result/)).not.toBeInTheDocument();

    emit(completedYouTubeRun(JSON.stringify({ Status: "success", Title: "Second run result" })));
    expect(screen.getByText(/Second run result/)).toBeInTheDocument();
  });
});
