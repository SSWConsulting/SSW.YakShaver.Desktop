import { describe, expect, it } from "vitest";
import { ShaveStatus } from "../types";
import { getShaveWorkflowPath } from "./shave-utils";

describe("getShaveWorkflowPath", () => {
  it("opens the selected workflow for a pending shave", () => {
    expect(getShaveWorkflowPath({ id: "pending-shave", shaveStatus: ShaveStatus.Pending })).toBe(
      "/workflow/pending-shave",
    );
  });

  it("opens the selected workflow for a processing shave", () => {
    expect(
      getShaveWorkflowPath({ id: "processing-shave", shaveStatus: ShaveStatus.Processing }),
    ).toBe("/workflow/processing-shave");
  });

  it("opens the persisted outcome for a finished shave", () => {
    expect(
      getShaveWorkflowPath({ id: "completed-shave", shaveStatus: ShaveStatus.Completed }),
    ).toBe("/workflow/completed-shave");
  });
});
