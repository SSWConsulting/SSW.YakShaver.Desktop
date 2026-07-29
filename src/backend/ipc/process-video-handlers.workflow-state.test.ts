import { beforeEach, describe, expect, it, vi } from "vitest";

type RegisteredHandler = (...args: unknown[]) => unknown;

const testState = vi.hoisted(() => {
  const workflowState = {
    uploading_video: { stage: "uploading_video", status: "not_started" },
    downloading_video: { stage: "downloading_video", status: "not_started" },
    converting_audio: { stage: "converting_audio", status: "not_started" },
    transcribing: { stage: "transcribing", status: "not_started" },
    optimizing_transcript: { stage: "optimizing_transcript", status: "not_started" },
    analyzing_transcript: { stage: "analyzing_transcript", status: "not_started" },
    selecting_prompt: { stage: "selecting_prompt", status: "not_started" },
    executing_task: { stage: "executing_task", status: "not_started" },
    updating_metadata: { stage: "updating_metadata", status: "not_started" },
  };

  return {
    registeredHandlers: new Map<string, RegisteredHandler>(),
    getVideoMetadata: vi.fn(),
    reset: vi.fn(),
    skipStage: vi.fn(),
    startStage: vi.fn(),
    createCheckpoint: vi.fn(),
    failStage: vi.fn(),
    getState: vi.fn(() => workflowState),
  };
});

vi.mock("electron", () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: RegisteredHandler) => {
      testState.registeredHandlers.set(channel, handler);
    }),
  },
}));

vi.mock("../services/auth/youtube-client", () => ({
  YouTubeClient: { getInstance: () => ({}) },
}));

vi.mock("../services/ffmpeg/ffmpeg-service", () => ({
  FFmpegService: { getInstance: () => ({}) },
}));

vi.mock("../services/video/video-metadata-builder", () => ({
  VideoMetadataBuilder: vi.fn(),
}));

vi.mock("../services/video/youtube-service", () => ({
  YouTubeDownloadService: {
    getInstance: () => ({ getVideoMetadata: testState.getVideoMetadata }),
  },
}));

vi.mock("../services/workflow/workflow-retry-service", () => ({
  WorkflowRetryService: vi.fn().mockImplementation(function WorkflowRetryService() {
    return { retryFromStage: vi.fn() };
  }),
  resolveCheckpointData: vi.fn(),
  validateCheckpointData: vi.fn(),
}));

vi.mock("../services/workflow/workflow-state-manager", () => ({
  WorkflowStateManager: vi.fn().mockImplementation(function WorkflowStateManager(shaveId?: string) {
    return {
      getWorkflowId: () => shaveId ?? "generated-workflow",
      getState: testState.getState,
      reset: testState.reset,
      skipStage: testState.skipStage,
      startStage: testState.startStage,
      createCheckpoint: testState.createCheckpoint,
      failStage: testState.failStage,
    };
  }),
}));

vi.mock("../utils/error-utils", () => ({
  formatAndReportError: (error: unknown) =>
    error instanceof Error ? error.message : String(error),
}));

import { IPC_CHANNELS } from "./channels";
import { ProcessVideoIPCHandlers } from "./process-video-handlers";

function getHandler(channel: string): RegisteredHandler {
  const handler = testState.registeredHandlers.get(channel);
  if (!handler) {
    throw new Error(`Expected handler for ${channel}`);
  }
  return handler;
}

beforeEach(() => {
  vi.clearAllMocks();
  testState.registeredHandlers.clear();
  testState.getVideoMetadata.mockRejectedValue(new Error("Download unavailable"));
  new ProcessVideoIPCHandlers();
});

describe("workflow:get-state", () => {
  it("distinguishes an invalid request from a missing in-memory workflow", async () => {
    const handler = getHandler(IPC_CHANNELS.WORKFLOW_GET_STATE);

    await expect(handler(undefined)).resolves.toEqual({
      success: false,
      reason: "invalid_request",
      error: "Shave ID is required",
    });
    await expect(handler(undefined, "missing-shave")).resolves.toEqual({
      success: false,
      reason: "not_found",
      error: "Workflow not found",
    });
  });

  it("returns the current state for a URL workflow and resets reused state first", async () => {
    const processUrl = getHandler(IPC_CHANNELS.PROCESS_VIDEO_URL);

    await expect(processUrl(undefined, "https://youtu.be/example", "shave-1")).resolves.toEqual({
      success: false,
      error: "Download unavailable",
      workflowId: "shave-1",
    });
    expect(testState.reset).toHaveBeenCalledTimes(1);

    const getState = getHandler(IPC_CHANNELS.WORKFLOW_GET_STATE);
    await expect(getState(undefined, "shave-1")).resolves.toEqual({
      success: true,
      state: testState.getState(),
    });
  });
});
