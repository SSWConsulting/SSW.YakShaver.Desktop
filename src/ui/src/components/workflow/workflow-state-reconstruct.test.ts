import { describe, expect, it } from "vitest";
import { reconstructWorkflowState } from "./workflow-state-reconstruct";

describe("reconstructWorkflowState (#821)", () => {
  it("marks every stage completed for a Completed shave", () => {
    const state = reconstructWorkflowState("Completed");
    expect(state).not.toBeNull();
    const steps = Object.values(state ?? {});
    expect(steps).toHaveLength(9);
    for (const step of steps) {
      expect(step.status).toBe("completed");
    }
  });

  it("returns null where per-stage progress can't be honestly asserted", () => {
    // The per-stage state isn't persisted, so for non-Completed shaves we don't fake a stage
    // picture — the caller (ShaveOutcomeView) shows the status + error/in-progress message.
    // Processing is intentionally null here: ShaveOutcomeView renders an "is still running"
    // placeholder for it (rather than a fabricated stage view) — see #888 review.
    expect(reconstructWorkflowState("Failed")).toBeNull();
    expect(reconstructWorkflowState("Cancelled")).toBeNull();
    expect(reconstructWorkflowState("Pending")).toBeNull();
    expect(reconstructWorkflowState("Processing")).toBeNull();
    expect(reconstructWorkflowState("Unknown")).toBeNull();
  });
});
