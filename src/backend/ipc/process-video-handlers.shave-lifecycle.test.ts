import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProgressStage } from "../../shared/types/workflow";

/**
 * #1062: My Shaves showed runs as "Processing" forever with a Stop button that did nothing.
 * The backend now records how a run ends badly (Failed / Cancelled), Stop reaches the run, and
 * Retry re-runs the whole workflow on the same video.
 */

const testState = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  updateShaveStatus: vi.fn(),
  getShaveById: vi.fn(),
  getShaveRecordingFile: vi.fn(),
  isWithinRootDir: vi.fn(),
  existsSync: vi.fn(),
}));

vi.mock("electron", () => ({
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) =>
      testState.handlers.set(channel, handler),
  },
}));
vi.mock("node:fs", () => ({ default: { existsSync: testState.existsSync } }));
vi.mock("../services/auth/youtube-client", () => ({
  YouTubeClient: { getInstance: () => ({}) },
}));
vi.mock("../services/ffmpeg/ffmpeg-service", () => ({
  FFmpegService: { getInstance: () => ({}) },
}));
vi.mock("../services/video/video-metadata-builder", () => ({
  VideoMetadataBuilder: vi.fn().mockImplementation(function VideoMetadataBuilder() {
    return {};
  }),
}));
vi.mock("../services/video/youtube-service", () => ({
  YouTubeDownloadService: { getInstance: () => ({}) },
}));
vi.mock("../services/video/local-video-storage", () => ({
  LocalVideoStorageService: {
    getInstance: () => ({ isWithinRootDir: testState.isWithinRootDir }),
  },
}));
vi.mock("../services/shave/shave-service", () => ({
  ShaveService: {
    getInstance: () => ({
      updateShave: vi.fn(),
      updateShaveStatus: testState.updateShaveStatus,
      getShaveById: testState.getShaveById,
      getShaveRecordingFile: testState.getShaveRecordingFile,
      getShaveVideoSourceInfo: vi.fn(() => undefined),
      attachVideoSourceToShave: vi.fn(),
      markShaveVideoFilesAsDeleted: vi.fn(),
    }),
  },
}));
vi.mock("../services/storage/llm-storage", () => ({
  LlmStorage: { getInstance: () => ({ getLLMConfig: vi.fn(() => null) }) },
}));
vi.mock("../services/workflow/workflow-retry-service", () => ({
  WorkflowRetryService: vi.fn().mockImplementation(function WorkflowRetryService() {
    return { retryFromStage: vi.fn() };
  }),
  resolveCheckpointData: vi.fn(() => ({})),
  validateCheckpointData: vi.fn(() => ({ valid: true, missing: [] })),
}));
vi.mock("../services/workflow/workflow-state-manager", () => ({
  WorkflowStateManager: vi.fn().mockImplementation(function WorkflowStateManager() {
    return { getWorkflowId: () => "shave-1", reset: vi.fn(), clearAllCheckpoints: vi.fn() };
  }),
}));
vi.mock("../utils/error-utils", () => ({
  formatAndReportError: (error: unknown) =>
    error instanceof Error ? error.message : String(error),
}));

import { WORKFLOW_STOPPED_BY_USER_MESSAGE } from "../services/workflow/workflow-cancelled-error";
import { ShaveStatus } from "../types";
import { IPC_CHANNELS } from "./channels";
import { ProcessVideoIPCHandlers } from "./process-video-handlers";

const SHAVE_ID = "shave-1";
const LOCAL_FOLDER = "C:/Users/me/Videos/YakShaver/2026-10-22 0905";
const LOCAL_RECORDING = `${LOCAL_FOLDER}/recording.webm`;

type RunResult = { success: boolean; error?: string };

interface TestableHandler {
  processFileVideo: (...args: unknown[]) => Promise<RunResult>;
  processUrlVideo: (...args: unknown[]) => Promise<RunResult>;
  stopControllers: Map<string, AbortController>;
  activeWorkflows: Set<string>;
  processVideoSource(
    context: { filePath: string; shaveId: string; youtubeResult: { success: boolean } },
    workflowManager: unknown,
  ): Promise<RunResult>;
}

/** A handler whose actual file/url pipelines are stubbed, so only the lifecycle logic runs. */
function createHandler() {
  const handler = new ProcessVideoIPCHandlers() as unknown as TestableHandler;
  handler.processFileVideo = vi.fn().mockResolvedValue({ success: true });
  handler.processUrlVideo = vi.fn().mockResolvedValue({ success: true });
  return handler;
}

function invoke(channel: string, ...args: unknown[]): Promise<RunResult> {
  const handle = testState.handlers.get(channel);
  if (!handle) throw new Error(`No handler registered for ${channel}`);
  return handle({}, ...args) as Promise<RunResult>;
}

beforeEach(() => {
  testState.handlers.clear();
  testState.updateShaveStatus.mockReset();
  testState.getShaveById.mockReset().mockReturnValue({
    id: SHAVE_ID,
    shaveStatus: ShaveStatus.Processing,
    videoEmbedUrl: null,
  });
  testState.getShaveRecordingFile.mockReset().mockReturnValue(undefined);
  testState.isWithinRootDir.mockReset().mockReturnValue(true);
  testState.existsSync.mockReset().mockReturnValue(true);
});

describe("recording how a run ends", () => {
  it("marks the shave Failed when the run fails before producing a work item", async () => {
    const handler = createHandler();
    vi.mocked(handler.processFileVideo).mockResolvedValue({ success: false, error: "No speech" });

    await invoke(IPC_CHANNELS.PROCESS_VIDEO_FILE, "/tmp/rec.webm", SHAVE_ID);

    expect(testState.updateShaveStatus).toHaveBeenCalledWith(SHAVE_ID, ShaveStatus.Failed);
  });

  it("marks the shave Cancelled when the user stopped it", async () => {
    const handler = createHandler();
    vi.mocked(handler.processFileVideo).mockResolvedValue({
      success: false,
      error: WORKFLOW_STOPPED_BY_USER_MESSAGE,
    });

    await invoke(IPC_CHANNELS.PROCESS_VIDEO_FILE, "/tmp/rec.webm", SHAVE_ID);

    expect(testState.updateShaveStatus).toHaveBeenCalledWith(SHAVE_ID, ShaveStatus.Cancelled);
  });

  it("marks the shave Failed when the run throws", async () => {
    const handler = createHandler();
    vi.mocked(handler.processFileVideo).mockRejectedValue(new Error("boom"));

    await expect(
      invoke(IPC_CHANNELS.PROCESS_VIDEO_FILE, "/tmp/rec.webm", SHAVE_ID),
    ).rejects.toThrow("boom");
    expect(testState.updateShaveStatus).toHaveBeenCalledWith(SHAVE_ID, ShaveStatus.Failed);
  });

  it("leaves a successful run's status to the UI, which records it from the final output", async () => {
    createHandler();

    await invoke(IPC_CHANNELS.PROCESS_VIDEO_FILE, "/tmp/rec.webm", SHAVE_ID);

    expect(testState.updateShaveStatus).not.toHaveBeenCalled();
  });

  it("never downgrades a shave that already completed", async () => {
    const handler = createHandler();
    testState.getShaveById.mockReturnValue({ id: SHAVE_ID, shaveStatus: ShaveStatus.Completed });
    vi.mocked(handler.processFileVideo).mockResolvedValue({ success: false, error: "late error" });

    await invoke(IPC_CHANNELS.PROCESS_VIDEO_FILE, "/tmp/rec.webm", SHAVE_ID);

    expect(testState.updateShaveStatus).not.toHaveBeenCalled();
  });

  it("does not mark a running shave Failed when a second run for it is refused", async () => {
    const handler = createHandler();
    handler.activeWorkflows.add(SHAVE_ID);

    const result = await invoke(IPC_CHANNELS.PROCESS_VIDEO_FILE, "/tmp/rec.webm", SHAVE_ID);

    expect(result.success).toBe(false);
    expect(handler.processFileVideo).not.toHaveBeenCalled();
    expect(testState.updateShaveStatus).not.toHaveBeenCalled();
  });
});

describe("Stop", () => {
  it("aborts a running shave", async () => {
    const handler = createHandler();
    const controller = new AbortController();
    handler.stopControllers.set(SHAVE_ID, controller);

    await invoke(IPC_CHANNELS.WORKFLOW_STOP, SHAVE_ID);

    expect(controller.signal.aborted).toBe(true);
    expect(testState.updateShaveStatus).not.toHaveBeenCalled();
  });

  it("records a shave whose run is gone (e.g. after a restart) as Cancelled", async () => {
    createHandler();

    const result = await invoke(IPC_CHANNELS.WORKFLOW_STOP, SHAVE_ID);

    expect(result.success).toBe(true);
    expect(testState.updateShaveStatus).toHaveBeenCalledWith(SHAVE_ID, ShaveStatus.Cancelled);
  });

  it("ends the run before the next stage, marking that stage as stopped", async () => {
    const handler = new ProcessVideoIPCHandlers() as unknown as TestableHandler;
    const controller = new AbortController();
    controller.abort();
    handler.stopControllers.set(SHAVE_ID, controller);
    const workflowManager = {
      getWorkflowId: () => SHAVE_ID,
      startStage: vi.fn(),
      completeStage: vi.fn(),
      skipStage: vi.fn(),
      failStage: vi.fn(),
      createCheckpoint: vi.fn(),
      updateStagePayload: vi.fn(),
      getStepState: vi.fn(() => ({ status: "completed" as const })),
    };

    const result = await handler.processVideoSource(
      { filePath: "/tmp/rec.webm", shaveId: SHAVE_ID, youtubeResult: { success: false } },
      workflowManager,
    );

    expect(result).toEqual(
      expect.objectContaining({ success: false, error: WORKFLOW_STOPPED_BY_USER_MESSAGE }),
    );
    expect(workflowManager.failStage).toHaveBeenCalledWith(
      ProgressStage.CONVERTING_AUDIO,
      WORKFLOW_STOPPED_BY_USER_MESSAGE,
      { cancelled: true },
    );
    expect(workflowManager.startStage).not.toHaveBeenCalled();
  });
});

describe("Retry (re-run on the same video)", () => {
  it("re-runs a locally kept recording in place, without copying it again", async () => {
    const handler = createHandler();
    testState.getShaveRecordingFile.mockReturnValue({ localPath: LOCAL_RECORDING });

    const result = await invoke(IPC_CHANNELS.WORKFLOW_RESTART, SHAVE_ID);
    expect(result.success).toBe(true);
    expect(testState.updateShaveStatus).toHaveBeenCalledWith(SHAVE_ID, ShaveStatus.Processing);
    expect(handler.processFileVideo).toHaveBeenCalledWith(LOCAL_RECORDING, SHAVE_ID, undefined, {
      existingLocalFolder: LOCAL_FOLDER,
    });
  });

  it("re-processes the uploaded video when the recording is no longer on disk", async () => {
    const handler = createHandler();
    testState.getShaveRecordingFile.mockReturnValue({ localPath: "/tmp/deleted.webm" });
    testState.existsSync.mockReturnValue(false);
    testState.getShaveById.mockReturnValue({
      id: SHAVE_ID,
      shaveStatus: ShaveStatus.Failed,
      videoEmbedUrl: "https://www.youtube.com/embed/abc",
    });

    await invoke(IPC_CHANNELS.WORKFLOW_RESTART, SHAVE_ID);

    expect(handler.processUrlVideo).toHaveBeenCalledWith(
      "https://www.youtube.com/embed/abc",
      SHAVE_ID,
    );
    expect(handler.processFileVideo).not.toHaveBeenCalled();
  });

  it("explains when there is nothing left to retry from", async () => {
    const handler = createHandler();

    const result = await invoke(IPC_CHANNELS.WORKFLOW_RESTART, SHAVE_ID);

    expect(result).toEqual({
      success: false,
      error: "The original recording is no longer available, so this shave can't be retried.",
    });
    expect(handler.processFileVideo).not.toHaveBeenCalled();
    expect(testState.updateShaveStatus).not.toHaveBeenCalled();
  });

  it("refuses while the shave is still running", async () => {
    const handler = createHandler();
    handler.activeWorkflows.add(SHAVE_ID);

    const result = await invoke(IPC_CHANNELS.WORKFLOW_RESTART, SHAVE_ID);

    expect(result.success).toBe(false);
    expect(handler.processFileVideo).not.toHaveBeenCalled();
  });
});
