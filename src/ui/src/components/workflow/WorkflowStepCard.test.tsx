import { ProgressStage, type WorkflowStep } from "@shared/types/workflow";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { WorkflowStepCard } from "./WorkflowStepCard";

/**
 * #645: "Updating metadata" never showed a green tick after it actually completed.
 * WorkflowProgressPanel.test.tsx mocks WorkflowStepCard entirely (it only asserts the
 * panel's live/hydrated wiring), so nothing in the suite exercised the real status ->
 * icon mapping this component renders. This file closes that gap: it asserts the
 * completed/failed/in_progress/not_started/skipped contract directly against
 * WorkflowStepCard, for the updating_metadata stage specifically (the one the issue
 * reports) and, for completeness, a couple of other stages.
 */
function makeStep(
  status: WorkflowStep["status"],
  stage = ProgressStage.UPDATING_METADATA,
): WorkflowStep {
  return { stage, status };
}

describe("WorkflowStepCard status rendering (#645)", () => {
  it("renders a green completed indicator for updating_metadata once it has completed", () => {
    const step = makeStep("completed");
    step.payload = JSON.stringify({ title: "My Video", description: "desc" });

    render(<WorkflowStepCard step={step} label="Updating Metadata" shaveId="shave-1" />);

    // #523: expandable rows get a trailing ellipsis to signal there's more to see.
    expect(screen.getByText("Updating Metadata…")).toBeInTheDocument();
    expect(document.querySelector(".text-green-400")).not.toBeNull();
  });

  it("renders the spinner (in_progress) for updating_metadata while the YouTube update is running", () => {
    const step = makeStep("in_progress");

    render(<WorkflowStepCard step={step} label="Updating Metadata" shaveId="shave-1" />);

    expect(document.querySelector(".animate-spin")).not.toBeNull();
    expect(document.querySelector(".text-green-400")).toBeNull();
  });

  it("renders a red failed indicator but keeps the error detail collapsed by default (#523)", () => {
    const step = makeStep("failed");
    step.payload = JSON.stringify({ error: "YouTube metadata update failed: quota exceeded" });

    render(<WorkflowStepCard step={step} label="Updating Metadata" shaveId="shave-1" />);

    expect(document.querySelector(".text-red-400")).not.toBeNull();
    // #523: the full error message is opt-in — a collapsed failed row shows only a
    // subtle hint, not the prominent error block, until the user expands it.
    expect(screen.queryByText(/quota exceeded/)).not.toBeInTheDocument();
    expect(screen.getByText(/expand for details/i)).toBeInTheDocument();
  });

  it("reveals the full error detail once a collapsed failed row is expanded (#523)", async () => {
    const user = userEvent.setup();
    const step = makeStep("failed");
    step.payload = JSON.stringify({ error: "YouTube metadata update failed: quota exceeded" });

    render(<WorkflowStepCard step={step} label="Updating Metadata" shaveId="shave-1" />);

    await user.click(screen.getByText("Updating Metadata…"));

    expect(screen.getByText(/quota exceeded/)).toBeInTheDocument();
  });

  it("renders an empty (not_started) indicator before updating_metadata has run", () => {
    const step = makeStep("not_started");

    render(<WorkflowStepCard step={step} label="Updating Metadata" shaveId="shave-1" />);

    expect(screen.getByText("Updating Metadata")).toBeInTheDocument();
    expect(document.querySelector(".text-green-400")).toBeNull();
    expect(document.querySelector(".text-red-400")).toBeNull();
  });

  it("renders nothing when updating_metadata is skipped (external link / failed upload, #798)", () => {
    const step = makeStep("skipped");

    const { container } = render(
      <WorkflowStepCard step={step} label="Updating Metadata" shaveId="shave-1" />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("also ticks green for other stages once completed (executing_task)", () => {
    const step = makeStep("completed", ProgressStage.EXECUTING_TASK);

    render(<WorkflowStepCard step={step} label="Executing Task" shaveId="shave-1" />);

    expect(document.querySelector(".text-green-400")).not.toBeNull();
  });

  /**
   * #523: the panel was reported to "open the currently active item, then close it and
   * open another" as a workflow progressed. executing_task streams a live payload whose
   * `steps` array can transiently flip effectiveStatus between "completed" and "failed"
   * (hasExecutingTaskErrors) as later chunks arrive. Previously the error block for a
   * failed card rendered unconditionally (not gated by isExpanded), so every such flip
   * forced the card open or shut regardless of what the user had done. Now detail
   * content is gated purely on the local isExpanded state, so re-rendering with a
   * different payload must not change what's shown — only a user click can.
   */
  it("does not force detail open/closed as executing_task's live payload toggles effective status (#523)", () => {
    const erroredStep: WorkflowStep = {
      stage: ProgressStage.EXECUTING_TASK,
      status: "completed",
      payload: JSON.stringify({
        steps: [{ type: "tool_result", error: "boom" }],
      }),
    };
    const recoveredStep: WorkflowStep = {
      stage: ProgressStage.EXECUTING_TASK,
      status: "completed",
      payload: JSON.stringify({
        steps: [{ type: "tool_result" }],
      }),
    };

    const { rerender } = render(
      <WorkflowStepCard step={erroredStep} label="Executing Task" shaveId="shave-1" />,
    );

    // Collapsed by default — no detail content mounted despite the effective failure.
    expect(document.querySelector(".text-red-400")).not.toBeNull();
    expect(screen.queryByText("boom")).not.toBeInTheDocument();

    // A later chunk "recovers" the step (no more error entries) — still collapsed,
    // no forced open/close flicker from the payload change alone.
    rerender(<WorkflowStepCard step={recoveredStep} label="Executing Task" shaveId="shave-1" />);
    expect(document.querySelector(".text-green-400")).not.toBeNull();
    expect(screen.queryByText("boom")).not.toBeInTheDocument();

    // And flipping back to errored again still doesn't auto-open it.
    rerender(<WorkflowStepCard step={erroredStep} label="Executing Task" shaveId="shave-1" />);
    expect(document.querySelector(".text-red-400")).not.toBeNull();
    expect(screen.queryByText("boom")).not.toBeInTheDocument();
  });
});
