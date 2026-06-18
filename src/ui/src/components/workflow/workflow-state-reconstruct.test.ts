import { describe, expect, it } from "vitest";
import { reconstructWorkflowState } from "./workflow-state-reconstruct";

describe("reconstructWorkflowState (#821)", () => {
  it("marks every stage completed for a Completed shave", () => {
    const state = reconstructWorkflowState("Completed");
    expect(state).not.toBeNull();
    const steps = Object.values(state ?? {});
    expect(steps).toHaveLength(8);
    for (const step of steps) {
      expect(step.status).toBe("completed");
    }
  });

  it("returns null where per-stage progress can't be honestly asserted", () => {
    // The per-stage state isn't persisted, so for non-Completed shaves we don't fake a stage
    // picture — the caller shows the status + error instead.
    expect(reconstructWorkflowState("Failed")).toBeNull();
    expect(reconstructWorkflowState("Cancelled")).toBeNull();
    expect(reconstructWorkflowState("Pending")).toBeNull();
    expect(reconstructWorkflowState("Unknown")).toBeNull();
  });
});
