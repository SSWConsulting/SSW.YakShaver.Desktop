import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProgressStage } from "../../../shared/types/workflow";
import { IPC_CHANNELS } from "../../ipc/channels";
import { WorkflowStateManager } from "./workflow-state-manager";

const testState = vi.hoisted(() => ({
  clearAll: vi.fn(),
  send: vi.fn(),
  trackError: vi.fn(),
  trackWorkflowStage: vi.fn(),
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
      trackError: testState.trackError,
      trackEvent: vi.fn(),
      trackWorkflowStage: testState.trackWorkflowStage,
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

describe("WorkflowStateManager.failStage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const readPayload = (manager: WorkflowStateManager) =>
    JSON.parse(manager.getStepState(ProgressStage.SELECTING_PROMPT).payload ?? "{}");

  it("records a genuine failure as an error, with no cancelled flag", () => {
    const manager = new WorkflowStateManager("shave-1");

    manager.failStage(ProgressStage.SELECTING_PROMPT, "boom");

    expect(readPayload(manager)).toEqual({ error: "boom" });
    expect(testState.trackError).toHaveBeenCalled();
    expect(testState.trackWorkflowStage).toHaveBeenCalledWith(
      expect.objectContaining({ status: "failed" }),
    );
  });

  it("marks a user-initiated stop as cancelled and keeps it out of error telemetry", () => {
    const manager = new WorkflowStateManager("shave-1");

    manager.failStage(ProgressStage.SELECTING_PROMPT, "You stopped this run.", {
      cancelled: true,
    });

    expect(readPayload(manager)).toEqual({ error: "You stopped this run.", cancelled: true });
    expect(manager.getStepState(ProgressStage.SELECTING_PROMPT).status).toBe("failed");
    expect(testState.trackError).not.toHaveBeenCalled();
    expect(testState.trackWorkflowStage).toHaveBeenCalledWith(
      expect.objectContaining({ status: "cancelled" }),
    );
  });
});
