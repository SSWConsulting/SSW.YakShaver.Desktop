import { ProgressStage, type WorkflowState, type WorkflowStatus } from "@shared/types/workflow";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MCPStepType } from "@/types";
import { WORKFLOW_CLEAR_EVENT_CHANNEL } from "../../types/index";
import { WorkflowProgressPanel } from "./WorkflowProgressPanel";

type ProgressCallback = (payload: unknown) => void;

// Captures the renderer's progress listener so the test can push workflow state
// updates the same way the main process would over IPC.
let progressCallback: ProgressCallback | undefined;

function stubElectronApi() {
  const onProgressNeo = vi.fn((cb: ProgressCallback) => {
    progressCallback = cb;
    return () => {
      progressCallback = undefined;
    };
  });

  Object.defineProperty(window, "electronAPI", {
    configurable: true,
    writable: true,
    value: { workflow: { onProgressNeo } },
  });
}

function makeStep(status: WorkflowStatus, stage: ProgressStage = ProgressStage.UPLOADING_VIDEO) {
  return { stage, status };
}

function makeIdleState(): WorkflowState {
  return {
    uploading_video: makeStep("not_started", ProgressStage.UPLOADING_VIDEO),
    downloading_video: makeStep("not_started", ProgressStage.DOWNLOADING_VIDEO),
    converting_audio: makeStep("not_started", ProgressStage.CONVERTING_AUDIO),
    transcribing: makeStep("not_started", ProgressStage.TRANSCRIBING),
    analyzing_transcript: makeStep("not_started", ProgressStage.ANALYZING_TRANSCRIPT),
    selecting_prompt: makeStep("not_started", ProgressStage.SELECTING_PROMPT),
    executing_task: makeStep("not_started", ProgressStage.EXECUTING_TASK),
    updating_metadata: makeStep("not_started", ProgressStage.UPDATING_METADATA),
  };
}

// A workflow state where the upload stage has failed and everything else is idle.
function makeFailedState(): WorkflowState {
  const state = makeIdleState();
  state.uploading_video = makeStep("failed", ProgressStage.UPLOADING_VIDEO);
  return state;
}

// A run that the backend marked "completed" because the backlog item was created,
// yet whose executing_task payload still carries a tool-error step — the case the
// per-step card renders red but the raw-status failure check used to miss (#733).
function makeCompletedWithErrorsState(): WorkflowState {
  const state = makeIdleState();
  state.executing_task = {
    stage: ProgressStage.EXECUTING_TASK,
    status: "completed",
    payload: JSON.stringify({
      steps: [{ type: MCPStepType.TOOL_RESULT, error: "tool blew up" }],
    }),
  };
  return state;
}

afterEach(() => {
  progressCallback = undefined;
});

describe("WorkflowProgressPanel — clear on processing failure (#733)", () => {
  it("shows a Clear action when a run has failed and resets the panel when clicked", async () => {
    stubElectronApi();
    const user = userEvent.setup();

    render(<WorkflowProgressPanel />);

    // Nothing renders until a progress update arrives.
    expect(screen.queryByText("AI Workflow Progress")).not.toBeInTheDocument();

    // Push a failed workflow state, as the main process would.
    act(() => {
      progressCallback?.({ shaveId: "shave-1", state: makeFailedState() });
    });

    expect(screen.getByText("AI Workflow Progress")).toBeInTheDocument();
    const clearButton = screen.getByRole("button", { name: /clear failed workflow/i });
    expect(clearButton).toBeInTheDocument();
    expect(screen.getByText(/processing failed/i)).toBeInTheDocument();

    // Clearing dismisses the failed run and returns the panel to its empty state.
    await user.click(clearButton);

    expect(screen.queryByText("AI Workflow Progress")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /clear failed workflow/i }),
    ).not.toBeInTheDocument();
  });

  it("does not show a Clear action while a run is still in progress", () => {
    stubElectronApi();

    render(<WorkflowProgressPanel />);

    const inProgressState = makeFailedState();
    inProgressState.uploading_video = makeStep("in_progress");

    act(() => {
      progressCallback?.({ shaveId: "shave-2", state: inProgressState });
    });

    expect(screen.getByText("AI Workflow Progress")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /clear failed workflow/i }),
    ).not.toBeInTheDocument();
  });

  it("shows a Clear action when executing_task completed with error steps in its payload", () => {
    stubElectronApi();

    render(<WorkflowProgressPanel />);

    act(() => {
      progressCallback?.({ shaveId: "shave-err", state: makeCompletedWithErrorsState() });
    });

    expect(screen.getByText("AI Workflow Progress")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /clear failed workflow/i })).toBeInTheDocument();
    expect(screen.getByText(/processing failed/i)).toBeInTheDocument();
  });

  it("re-populates the panel after Clear when a fresh run arrives (Clear is a soft dismiss)", async () => {
    stubElectronApi();
    const user = userEvent.setup();

    render(<WorkflowProgressPanel />);

    act(() => {
      progressCallback?.({ shaveId: "shave-1", state: makeFailedState() });
    });

    await user.click(screen.getByRole("button", { name: /clear failed workflow/i }));
    expect(screen.queryByText("AI Workflow Progress")).not.toBeInTheDocument();

    // The listener stays subscribed, so a brand-new run still drives the panel.
    const fresh = makeFailedState();
    fresh.uploading_video = makeStep("in_progress");
    act(() => {
      progressCallback?.({ shaveId: "shave-2", state: fresh });
    });

    expect(screen.getByText("AI Workflow Progress")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /clear failed workflow/i }),
    ).not.toBeInTheDocument();
  });

  it("broadcasts a workflow-clear event so sibling panels reset together", async () => {
    stubElectronApi();
    const user = userEvent.setup();
    const onClear = vi.fn();
    window.addEventListener(WORKFLOW_CLEAR_EVENT_CHANNEL, onClear);

    render(<WorkflowProgressPanel />);

    act(() => {
      progressCallback?.({ shaveId: "shave-1", state: makeFailedState() });
    });

    await user.click(screen.getByRole("button", { name: /clear failed workflow/i }));

    expect(onClear).toHaveBeenCalledTimes(1);
    window.removeEventListener(WORKFLOW_CLEAR_EVENT_CHANNEL, onClear);
  });
});
