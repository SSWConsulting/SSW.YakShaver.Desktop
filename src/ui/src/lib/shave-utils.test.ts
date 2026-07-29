import { describe, expect, it } from "vitest";
import { ShaveStatus } from "../types";
import { getShaveWorkflowPath } from "./shave-utils";

describe("getShaveWorkflowPath", () => {
  it("opens the live workflow for a pending shave", () => {
    expect(getShaveWorkflowPath({ id: "pending-shave", shaveStatus: ShaveStatus.Pending })).toBe(
      "/workflow",
    );
  });

  it("opens the live workflow for a processing shave", () => {
    expect(
      getShaveWorkflowPath({ id: "processing-shave", shaveStatus: ShaveStatus.Processing }),
    ).toBe("/workflow");
  });

  it("opens the persisted outcome for a finished shave", () => {
    expect(
      getShaveWorkflowPath({ id: "completed-shave", shaveStatus: ShaveStatus.Completed }),
    ).toBe("/workflow/completed-shave");
  });
});
