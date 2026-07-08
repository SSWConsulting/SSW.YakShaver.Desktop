import { ProgressStage, type WorkflowStep } from "@shared/types/workflow";
import { render, screen } from "@testing-library/react";
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

    expect(screen.getByText("Updating Metadata")).toBeInTheDocument();
    expect(document.querySelector(".text-green-400")).not.toBeNull();
  });

  it("renders the spinner (in_progress) for updating_metadata while the YouTube update is running", () => {
    const step = makeStep("in_progress");

    render(<WorkflowStepCard step={step} label="Updating Metadata" shaveId="shave-1" />);

    expect(document.querySelector(".animate-spin")).not.toBeNull();
    expect(document.querySelector(".text-green-400")).toBeNull();
  });

  it("renders a red failed indicator with the error when updating_metadata fails", () => {
    const step = makeStep("failed");
    step.payload = JSON.stringify({ error: "YouTube metadata update failed: quota exceeded" });

    render(<WorkflowStepCard step={step} label="Updating Metadata" shaveId="shave-1" />);

    expect(document.querySelector(".text-red-400")).not.toBeNull();
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
});
