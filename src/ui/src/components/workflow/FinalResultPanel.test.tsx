import { ProgressStage, type WorkflowState, type WorkflowStatus } from "@shared/types/workflow";
import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WORKFLOW_CLEAR_EVENT_CHANNEL } from "../../types/index";
import { FinalResultPanel } from "./FinalResultPanel";

type ProgressCallback = (payload: unknown) => void;

// Captures the renderer's progress listener so the test can push workflow state
// the same way the main process would over IPC.
let progressCallback: ProgressCallback | undefined;

// FinalResultPanel reaches the IPC layer via the `ipcClient` singleton (bound to
// window.electronAPI at module load), so mock the module rather than the window.
vi.mock("../../services/ipc-client", () => ({
  ipcClient: {
    workflow: {
      onProgressNeo: (cb: ProgressCallback) => {
        progressCallback = cb;
        return () => {
          progressCallback = undefined;
        };
      },
    },
    mcp: {
      onStepUpdate: () => () => {},
    },
  },
}));

function makeStep(status: WorkflowStatus, stage: ProgressStage, payload?: string) {
  return { stage, status, payload };
}

// A run that produced a final output AND then had its metadata stage fail — the
// reachable state where the progress panel shows the failure banner/Clear while
// the Final Result card is also on screen (#733, #904 orphan finding).
function makeFinalOutputWithMetadataFailureState(): WorkflowState {
  return {
    uploading_video: makeStep("completed", ProgressStage.UPLOADING_VIDEO),
    downloading_video: makeStep("not_started", ProgressStage.DOWNLOADING_VIDEO),
    converting_audio: makeStep("completed", ProgressStage.CONVERTING_AUDIO),
    transcribing: makeStep("completed", ProgressStage.TRANSCRIBING),
    analyzing_transcript: makeStep("completed", ProgressStage.ANALYZING_TRANSCRIPT),
    selecting_prompt: makeStep("completed", ProgressStage.SELECTING_PROMPT),
    executing_task: makeStep(
      "completed",
      ProgressStage.EXECUTING_TASK,
      JSON.stringify({ finalOutput: "All done — backlog item created." }),
    ),
    updating_metadata: makeStep("failed", ProgressStage.UPDATING_METADATA),
  };
}

beforeEach(() => {
  progressCallback = undefined;
});

afterEach(() => {
  progressCallback = undefined;
});

describe("FinalResultPanel — clear coexistence (#733/#904)", () => {
  it("renders the Final Result card once a final output is produced", () => {
    render(<FinalResultPanel />);

    expect(screen.queryByText("Final Result")).not.toBeInTheDocument();

    act(() => {
      progressCallback?.({ shaveId: "shave-1", state: makeFinalOutputWithMetadataFailureState() });
    });

    expect(screen.getByText("Final Result")).toBeInTheDocument();
  });

  it("clears the orphaned Final Result card when the workflow-clear event fires", () => {
    render(<FinalResultPanel />);

    act(() => {
      progressCallback?.({ shaveId: "shave-1", state: makeFinalOutputWithMetadataFailureState() });
    });
    expect(screen.getByText("Final Result")).toBeInTheDocument();

    // The progress panel's Clear button broadcasts this event; the Final Result
    // card must reset too instead of lingering orphaned on the page.
    act(() => {
      window.dispatchEvent(new CustomEvent(WORKFLOW_CLEAR_EVENT_CHANNEL));
    });

    expect(screen.queryByText("Final Result")).not.toBeInTheDocument();
  });
});
