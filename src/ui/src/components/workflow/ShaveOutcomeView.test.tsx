import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ShaveStatus } from "../../types";
import { ShaveOutcomeView } from "./ShaveOutcomeView";

const { getById } = vi.hoisted(() => ({ getById: vi.fn() }));
vi.mock("../../services/ipc-client", () => ({
  ipcClient: { shave: { getById } },
}));
// The nested panel subscribes to electronAPI; stub it out for this view's tests.
vi.mock("./WorkflowProgressPanel", () => ({
  WorkflowProgressPanel: () => <div>workflow-progress</div>,
}));

const shave = (over: Record<string, unknown>) => ({
  id: "s1",
  title: "My shave",
  finalOutput: null,
  errorMessage: null,
  errorCode: null,
  workItemUrl: null,
  videoEmbedUrl: null,
  ...over,
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ShaveOutcomeView (#821 / #888 review)", () => {
  it("shows an in-progress message for a still-running (Processing) shave — no blank dead-end", async () => {
    getById.mockResolvedValue({
      success: true,
      data: shave({ shaveStatus: ShaveStatus.Processing }),
    });

    render(<ShaveOutcomeView shaveId="s1" />);

    expect(await screen.findByText("This shave is still running")).toBeInTheDocument();
  });

  it("shows the failure details for a Failed shave", async () => {
    getById.mockResolvedValue({
      success: true,
      data: shave({
        shaveStatus: ShaveStatus.Failed,
        errorMessage: "boom",
        errorCode: "E_X",
      }),
    });

    render(<ShaveOutcomeView shaveId="s1" />);

    expect(await screen.findByText("This shave failed")).toBeInTheDocument();
    expect(screen.getByText("boom")).toBeInTheDocument();
  });
});
