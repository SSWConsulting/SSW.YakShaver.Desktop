import { ProgressStage, type WorkflowState, type WorkflowStatus } from "@shared/types/workflow";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
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

function makeStep(status: WorkflowStatus) {
  return { stage: ProgressStage.UPLOADING_VIDEO, status };
}

// A workflow state where the upload stage has failed and everything else is idle.
function makeFailedState(): WorkflowState {
  return {
    uploading_video: makeStep("failed"),
    downloading_video: makeStep("not_started"),
    converting_audio: makeStep("not_started"),
    transcribing: makeStep("not_started"),
    analyzing_transcript: makeStep("not_started"),
    selecting_prompt: makeStep("not_started"),
    executing_task: makeStep("not_started"),
    updating_metadata: makeStep("not_started"),
  };
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
});
