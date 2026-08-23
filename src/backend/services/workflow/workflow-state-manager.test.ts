import { beforeEach, describe, expect, it, vi } from "vitest";
import { IPC_CHANNELS } from "../../ipc/channels";
import { WorkflowStateManager } from "./workflow-state-manager";

const testState = vi.hoisted(() => ({
  clearAll: vi.fn(),
  send: vi.fn(),
}));

vi.mock("electron", () => ({
  BrowserWindow: {
    getAllWindows: () => [
      {
        isDestroyed: () => false,
        webContents: { send: testState.send },
      },
    ],
  },
}));

vi.mock("../telemetry/telemetry-service", () => ({
  TelemetryService: {
    getInstance: () => ({
      trackError: vi.fn(),
      trackEvent: vi.fn(),
      trackWorkflowStage: vi.fn(),
    }),
  },
}));

vi.mock("./workflow-checkpoint-service", () => ({
  WorkflowCheckpointService: {
    getInstance: () => ({ clearAll: testState.clearAll }),
  },
}));

describe("WorkflowStateManager.reset", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("clears state without broadcasting an empty snapshot when silent", () => {
    const manager = new WorkflowStateManager("shave-1");

    manager.reset({ silent: true });

    expect(testState.clearAll).toHaveBeenCalledWith("shave-1");
    expect(testState.send).not.toHaveBeenCalled();
  });

  it("broadcasts reset state by default", () => {
    const manager = new WorkflowStateManager("shave-1");

    manager.reset();

    expect(testState.send).toHaveBeenCalledWith(
      IPC_CHANNELS.WORKFLOW_PROGRESS_NEO,
      expect.objectContaining({ shaveId: "shave-1" }),
    );
  });
});
