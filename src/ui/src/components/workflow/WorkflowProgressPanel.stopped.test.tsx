import { ProgressStage, type WorkflowState, type WorkflowStatus } from "@shared/types/workflow";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkflowProgressPanel } from "./WorkflowProgressPanel";

type ProgressCallback = (payload: unknown) => void;

const { onProgressNeo, progressCallbacks, retryFromStage } = vi.hoisted(() => {
  const callbacks: ProgressCallback[] = [];
  return {
    progressCallbacks: callbacks,
    onProgressNeo: vi.fn((callback: ProgressCallback) => {
      callbacks.push(callback);
      return () => {};
    }),
    retryFromStage: vi.fn().mockResolvedValue({ success: true }),
  };
});

vi.mock("@/services/ipc-client", () => ({
  ipcClient: { workflow: { onProgressNeo, retryFromStage } },
}));

function makeStep(status: WorkflowStatus, stage: ProgressStage, payload?: unknown) {
  return { stage, status, payload: payload ? JSON.stringify(payload) : undefined };
}

function makeIdleState(): WorkflowState {
  return {
    uploading_video: makeStep("completed", ProgressStage.UPLOADING_VIDEO),
    downloading_video: makeStep("skipped", ProgressStage.DOWNLOADING_VIDEO),
    converting_audio: makeStep("completed", ProgressStage.CONVERTING_AUDIO),
    transcribing: makeStep("completed", ProgressStage.TRANSCRIBING),
    optimizing_transcript: makeStep("completed", ProgressStage.OPTIMIZING_TRANSCRIPT),
    analyzing_transcript: makeStep("completed", ProgressStage.ANALYZING_TRANSCRIPT),
    selecting_prompt: makeStep("not_started", ProgressStage.SELECTING_PROMPT),
    executing_task: makeStep("not_started", ProgressStage.EXECUTING_TASK),
    updating_metadata: makeStep("not_started", ProgressStage.UPDATING_METADATA),
  };
}

/** The user hit Stop in the prompt-confirmation dialog: failed, but flagged as a deliberate stop. */
function makeStoppedState(): WorkflowState {
  const state = makeIdleState();
  state.selecting_prompt = makeStep("failed", ProgressStage.SELECTING_PROMPT, {
    error: "You stopped this run before a work item was created.",
    cancelled: true,
  });
  return state;
}

/** The same stage failing for a real reason carries no `cancelled` flag. */
function makeFailedState(): WorkflowState {
  const state = makeIdleState();
  state.selecting_prompt = makeStep("failed", ProgressStage.SELECTING_PROMPT, {
    error: "The model exploded",
  });
  return state;
}

function emitProgress(payload: unknown) {
  progressCallbacks[0]?.(payload);
}

afterEach(() => {
  progressCallbacks.length = 0;
  retryFromStage.mockClear();
});

describe("WorkflowProgressPanel — run stopped by the user", () => {
  it("says the user stopped the run instead of reporting a processing failure", () => {
    render(<WorkflowProgressPanel />);

    act(() => {
      emitProgress({ shaveId: "shave-1", state: makeStoppedState() });
    });

    expect(screen.getByText(/you stopped this run at/i)).toBeInTheDocument();
    expect(screen.queryByText(/processing failed/i)).not.toBeInTheDocument();
  });

  it("offers a retry for the stopped stage", async () => {
    const user = userEvent.setup();
    render(<WorkflowProgressPanel />);

    act(() => {
      emitProgress({ shaveId: "shave-1", state: makeStoppedState() });
    });

    await user.click(screen.getByRole("button", { name: /retry selecting prompt/i }));

    expect(retryFromStage).toHaveBeenCalledWith(ProgressStage.SELECTING_PROMPT, "shave-1");
  });

  it("still reports a genuine failure as a processing failure", () => {
    render(<WorkflowProgressPanel />);

    act(() => {
      emitProgress({ shaveId: "shave-1", state: makeFailedState() });
    });

    expect(screen.getByText(/processing failed/i)).toBeInTheDocument();
    expect(screen.queryByText(/you stopped this run at/i)).not.toBeInTheDocument();
  });
});
