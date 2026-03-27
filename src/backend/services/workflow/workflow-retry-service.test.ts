import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProgressStage } from "../../../shared/types/workflow";
import type { VideoUploadResult } from "../auth/types";
import { type CheckpointData, WorkflowCheckpointService } from "./workflow-checkpoint-service";
import {
  type RetryResult,
  resolveCheckpointData,
  validateCheckpointData,
  type WorkflowRetryDeps,
  WorkflowRetryService,
} from "./workflow-retry-service";
import { WorkflowStateManager } from "./workflow-state-manager";

// Mock electron (required by WorkflowStateManager -> broadcast -> BrowserWindow)
vi.mock("electron", () => ({
  BrowserWindow: { getAllWindows: vi.fn().mockReturnValue([]) },
}));

// Mock TelemetryService
vi.mock("../telemetry/telemetry-service", () => ({
  TelemetryService: {
    getInstance: () => ({
      trackEvent: vi.fn(),
      trackWorkflowStage: vi.fn(),
      trackError: vi.fn(),
    }),
  },
}));

// Mock ShaveService (used in retryUploadingVideo)
vi.mock("../shave/shave-service", () => ({
  ShaveService: {
    getInstance: () => ({
      getShaveVideoSourceInfo: vi.fn().mockReturnValue(null),
    }),
  },
}));

// Mock fs for file existence checks
vi.mock("node:fs", () => ({
  default: {
    existsSync: vi.fn().mockReturnValue(true),
  },
}));

// Mock error-utils
vi.mock("../../utils/error-utils", () => ({
  formatAndReportError: (error: unknown) =>
    error instanceof Error ? error.message : String(error),
  formatErrorMessage: (error: unknown) => (error instanceof Error ? error.message : String(error)),
}));

// Reset singleton checkpoint service between tests to avoid cross-test contamination
beforeEach(() => {
  // @ts-expect-error — resetting private singleton for test isolation
  WorkflowCheckpointService.instance = undefined;
});

const SHAVE_ID = "test-shave-id";

function createMockYoutubeResult(overrides?: Partial<VideoUploadResult>): VideoUploadResult {
  return {
    success: true,
    origin: "upload",
    data: { videoId: "vid-123", url: "https://youtube.com/watch?v=vid-123" },
    ...overrides,
  } as VideoUploadResult;
}

function createMockDeps(overrides?: Partial<WorkflowRetryDeps>): WorkflowRetryDeps {
  return {
    youtube: {
      uploadVideo: vi.fn().mockResolvedValue(createMockYoutubeResult()),
    } as unknown as WorkflowRetryDeps["youtube"],
    youtubeDownloadService: {
      getVideoMetadata: vi.fn().mockResolvedValue(createMockYoutubeResult({ origin: "external" })),
      downloadVideoToFile: vi.fn().mockResolvedValue("/tmp/downloaded.mp4"),
    } as unknown as WorkflowRetryDeps["youtubeDownloadService"],
    processVideoSource: vi.fn().mockResolvedValue({ success: true } satisfies RetryResult),
    emitProgress: vi.fn(),
    trackTempFile: vi.fn(),
    getLastVideoFilePath: vi.fn().mockReturnValue("/tmp/test-video.mp4"),
    getOrCreateWorkflowManager: vi.fn(),
    ...overrides,
  };
}

/**
 * Helper: set up a WorkflowStateManager with stages completed up to (but not
 * including) the given failStage, then mark failStage as failed.
 * Creates checkpoints for all completed stages.
 */
function setupFailedWorkflow(failStage: string, shaveId = SHAVE_ID): WorkflowStateManager {
  const manager = new WorkflowStateManager(shaveId);

  const stageData: Record<string, CheckpointData> = {
    uploading_video: { filePath: "/tmp/test.mp4", youtubeResult: createMockYoutubeResult() },
    downloading_video: {
      filePath: "/tmp/test.mp4",
      youtubeResult: createMockYoutubeResult({ origin: "external" }),
      downloadUrl: "https://youtube.com/watch?v=abc",
    },
    converting_audio: { mp3FilePath: "/tmp/test.mp3" },
    transcribing: {
      transcript: [{ text: "hello" }] as CheckpointData["transcript"],
      transcriptText: "hello",
    },
    analyzing_transcript: { intermediateOutput: '{"task":"test"}' },
    selecting_prompt: {
      projectDetails: { name: "Test" },
      projectMetaData: "{}",
      desktopAgentProjectPrompt: "prompt",
    },
    executing_task: { mcpResult: "result", finalOutput: "output" },
    updating_metadata: {},
  };

  const stages = [
    ProgressStage.UPLOADING_VIDEO,
    ProgressStage.DOWNLOADING_VIDEO,
    ProgressStage.CONVERTING_AUDIO,
    ProgressStage.TRANSCRIBING,
    ProgressStage.ANALYZING_TRANSCRIPT,
    ProgressStage.SELECTING_PROMPT,
    ProgressStage.EXECUTING_TASK,
    ProgressStage.UPDATING_METADATA,
  ];

  for (const stage of stages) {
    if (stage === failStage) {
      manager.startStage(stage);
      manager.failStage(stage, "Simulated failure");
      break;
    }
    manager.startStage(stage);
    manager.completeStage(stage);
    manager.createCheckpoint(stage, stageData[stage] ?? {});
  }

  return manager;
}

// ─── resolveCheckpointData ───────────────────────────────────────────────

describe("resolveCheckpointData", () => {
  it("merges checkpoint data from all stages up to the target", () => {
    const manager = new WorkflowStateManager(SHAVE_ID);
    manager.createCheckpoint(ProgressStage.UPLOADING_VIDEO, { filePath: "/a.mp4" });
    manager.createCheckpoint(ProgressStage.CONVERTING_AUDIO, { mp3FilePath: "/a.mp3" });
    manager.createCheckpoint(ProgressStage.TRANSCRIBING, { transcriptText: "hello" });

    const merged = resolveCheckpointData(manager, ProgressStage.TRANSCRIBING);

    expect(merged.filePath).toBe("/a.mp4");
    expect(merged.mp3FilePath).toBe("/a.mp3");
    expect(merged.transcriptText).toBe("hello");
  });

  it("does not include data from stages after the target", () => {
    const manager = new WorkflowStateManager(SHAVE_ID);
    manager.createCheckpoint(ProgressStage.UPLOADING_VIDEO, { filePath: "/a.mp4" });
    manager.createCheckpoint(ProgressStage.EXECUTING_TASK, { mcpResult: "secret" });

    const merged = resolveCheckpointData(manager, ProgressStage.CONVERTING_AUDIO);

    expect(merged.filePath).toBe("/a.mp4");
    expect(merged.mcpResult).toBeUndefined();
  });

  it("returns empty object when no checkpoints exist", () => {
    const manager = new WorkflowStateManager(SHAVE_ID);
    const merged = resolveCheckpointData(manager, ProgressStage.TRANSCRIBING);
    expect(merged).toEqual({});
  });
});

// ─── validateCheckpointData ──────────────────────────────────────────────

describe("validateCheckpointData", () => {
  it("returns valid when all required fields are present", () => {
    const result = validateCheckpointData(ProgressStage.TRANSCRIBING, {
      mp3FilePath: "/a.mp3",
    });
    expect(result.valid).toBe(true);
    expect(result.missing).toEqual([]);
  });

  it("returns invalid with missing fields", () => {
    const result = validateCheckpointData(ProgressStage.TRANSCRIBING, {});
    expect(result.valid).toBe(false);
    expect(result.missing).toContain("mp3FilePath");
  });

  it("reports missing fields for stages with unmet requirements", () => {
    const result = validateCheckpointData(ProgressStage.ANALYZING_TRANSCRIPT, {});
    expect(result.valid).toBe(false);
    expect(result.missing).toContain("transcriptText");
  });

  it("returns valid for stages with no required inputs (uploading_video)", () => {
    const result = validateCheckpointData(ProgressStage.UPLOADING_VIDEO, {});
    expect(result.valid).toBe(true);
  });
});

// ─── WorkflowStateManager.prepareStageForRetry ──────────────────────────

describe("WorkflowStateManager.prepareStageForRetry", () => {
  it("returns false if stage is not in failed state", () => {
    const manager = new WorkflowStateManager(SHAVE_ID);
    manager.startStage(ProgressStage.CONVERTING_AUDIO);
    manager.completeStage(ProgressStage.CONVERTING_AUDIO);

    expect(manager.prepareStageForRetry(ProgressStage.CONVERTING_AUDIO)).toBe(false);
  });

  it("returns false for not_started stage", () => {
    const manager = new WorkflowStateManager(SHAVE_ID);
    expect(manager.prepareStageForRetry(ProgressStage.CONVERTING_AUDIO)).toBe(false);
  });

  it("returns true and resets stages from failed stage onward", () => {
    const manager = setupFailedWorkflow(ProgressStage.TRANSCRIBING);

    const result = manager.prepareStageForRetry(ProgressStage.TRANSCRIBING);

    expect(result).toBe(true);
    // Failed stage should be reset to not_started
    expect(manager.getStepState(ProgressStage.TRANSCRIBING).status).toBe("not_started");
    // Stages after should also be reset
    expect(manager.getStepState(ProgressStage.ANALYZING_TRANSCRIPT).status).toBe("not_started");
    // Stages before should remain completed
    expect(manager.getStepState(ProgressStage.CONVERTING_AUDIO).status).toBe("completed");
  });

  it("preserves skipped stages during reset", () => {
    const manager = new WorkflowStateManager(SHAVE_ID);
    manager.skipStage(ProgressStage.UPLOADING_VIDEO);
    manager.startStage(ProgressStage.DOWNLOADING_VIDEO);
    manager.failStage(ProgressStage.DOWNLOADING_VIDEO, "fail");

    manager.prepareStageForRetry(ProgressStage.DOWNLOADING_VIDEO);

    expect(manager.getStepState(ProgressStage.UPLOADING_VIDEO).status).toBe("skipped");
    expect(manager.getStepState(ProgressStage.DOWNLOADING_VIDEO).status).toBe("not_started");
  });
});

// ─── WorkflowStateManager.getRetryableFailedStages ──────────────────────

describe("WorkflowStateManager.getRetryableFailedStages", () => {
  it("returns empty array when no stages failed", () => {
    const manager = new WorkflowStateManager(SHAVE_ID);
    expect(manager.getRetryableFailedStages()).toEqual([]);
  });

  it("returns failed stages with error messages", () => {
    const manager = setupFailedWorkflow(ProgressStage.TRANSCRIBING);
    const failed = manager.getRetryableFailedStages();

    expect(failed).toHaveLength(1);
    expect(failed[0].stage).toBe(ProgressStage.TRANSCRIBING);
    expect(failed[0].lastError).toBe("Simulated failure");
  });
});

// ─── WorkflowRetryService ───────────────────────────────────────────────

describe("WorkflowRetryService", () => {
  let deps: WorkflowRetryDeps;
  let service: WorkflowRetryService;

  beforeEach(() => {
    deps = createMockDeps();
    service = new WorkflowRetryService(deps);
  });

  it("returns error when shaveId is not provided", async () => {
    const result = await service.retryFromStage(ProgressStage.CONVERTING_AUDIO);
    expect(result.success).toBe(false);
    expect(result.error).toContain("Shave ID is required");
  });

  it("returns error when stage is not in failed state", async () => {
    const manager = new WorkflowStateManager(SHAVE_ID);
    (deps.getOrCreateWorkflowManager as ReturnType<typeof vi.fn>).mockReturnValue(manager);

    const result = await service.retryFromStage(ProgressStage.CONVERTING_AUDIO, SHAVE_ID);

    expect(result.success).toBe(false);
    expect(result.error).toContain("Cannot retry stage");
  });

  it("retries uploading_video by re-uploading the file", async () => {
    const manager = setupFailedWorkflow(ProgressStage.UPLOADING_VIDEO);
    manager.createCheckpoint(ProgressStage.UPLOADING_VIDEO, { filePath: "/tmp/test.mp4" });
    (deps.getOrCreateWorkflowManager as ReturnType<typeof vi.fn>).mockReturnValue(manager);

    await service.retryFromStage(ProgressStage.UPLOADING_VIDEO, SHAVE_ID);

    expect(deps.youtube.uploadVideo).toHaveBeenCalledWith("/tmp/test.mp4");
    expect(deps.processVideoSource).toHaveBeenCalled();
  });

  it("retries downloading_video by re-downloading the URL", async () => {
    const manager = new WorkflowStateManager(SHAVE_ID);
    manager.skipStage(ProgressStage.UPLOADING_VIDEO);
    manager.startStage(ProgressStage.DOWNLOADING_VIDEO);
    manager.failStage(ProgressStage.DOWNLOADING_VIDEO, "Download failed");
    manager.createCheckpoint(ProgressStage.DOWNLOADING_VIDEO, {
      downloadUrl: "https://youtube.com/watch?v=abc",
    });
    (deps.getOrCreateWorkflowManager as ReturnType<typeof vi.fn>).mockReturnValue(manager);

    await service.retryFromStage(ProgressStage.DOWNLOADING_VIDEO, SHAVE_ID);

    expect(deps.youtubeDownloadService.getVideoMetadata).toHaveBeenCalledWith(
      "https://youtube.com/watch?v=abc",
    );
    expect(deps.youtubeDownloadService.downloadVideoToFile).toHaveBeenCalledWith(
      "https://youtube.com/watch?v=abc",
    );
    expect(deps.processVideoSource).toHaveBeenCalled();
  });

  it("retries middle stage by delegating to processVideoSource with startFromStage", async () => {
    const manager = setupFailedWorkflow(ProgressStage.ANALYZING_TRANSCRIPT);
    (deps.getOrCreateWorkflowManager as ReturnType<typeof vi.fn>).mockReturnValue(manager);

    await service.retryFromStage(ProgressStage.ANALYZING_TRANSCRIPT, SHAVE_ID);

    expect(deps.processVideoSource).toHaveBeenCalledWith(
      expect.objectContaining({ shaveId: SHAVE_ID }),
      manager,
      ProgressStage.ANALYZING_TRANSCRIPT,
    );
  });

  it("returns error when middle stage retry has no checkpoint data", async () => {
    const manager = new WorkflowStateManager(SHAVE_ID);
    manager.startStage(ProgressStage.ANALYZING_TRANSCRIPT);
    manager.failStage(ProgressStage.ANALYZING_TRANSCRIPT, "fail");
    // No checkpoints set — filePath and youtubeResult will be missing
    (deps.getOrCreateWorkflowManager as ReturnType<typeof vi.fn>).mockReturnValue(manager);
    (deps.getLastVideoFilePath as ReturnType<typeof vi.fn>).mockReturnValue(undefined);

    const result = await service.retryFromStage(ProgressStage.ANALYZING_TRANSCRIPT, SHAVE_ID);

    expect(result.success).toBe(false);
    expect(result.error).toContain("checkpoint data not found");
  });

  it("handles upload failure during retry gracefully", async () => {
    const manager = setupFailedWorkflow(ProgressStage.UPLOADING_VIDEO);
    manager.createCheckpoint(ProgressStage.UPLOADING_VIDEO, { filePath: "/tmp/test.mp4" });
    (deps.getOrCreateWorkflowManager as ReturnType<typeof vi.fn>).mockReturnValue(manager);
    (deps.youtube.uploadVideo as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("YouTube API error"),
    );

    const result = await service.retryFromStage(ProgressStage.UPLOADING_VIDEO, SHAVE_ID);

    expect(result.success).toBe(false);
    expect(result.error).toContain("YouTube API error");
    // Stage should be marked as failed again
    expect(manager.getStepState(ProgressStage.UPLOADING_VIDEO).status).toBe("failed");
  });

  it("handles download failure during retry gracefully", async () => {
    const manager = new WorkflowStateManager(SHAVE_ID);
    manager.skipStage(ProgressStage.UPLOADING_VIDEO);
    manager.startStage(ProgressStage.DOWNLOADING_VIDEO);
    manager.failStage(ProgressStage.DOWNLOADING_VIDEO, "fail");
    manager.createCheckpoint(ProgressStage.DOWNLOADING_VIDEO, {
      downloadUrl: "https://youtube.com/watch?v=abc",
    });
    (deps.getOrCreateWorkflowManager as ReturnType<typeof vi.fn>).mockReturnValue(manager);
    (deps.youtubeDownloadService.getVideoMetadata as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("Network error"),
    );

    const result = await service.retryFromStage(ProgressStage.DOWNLOADING_VIDEO, SHAVE_ID);

    expect(result.success).toBe(false);
    expect(result.error).toContain("Network error");
  });

  it("returns error when download URL is missing for download retry", async () => {
    const manager = new WorkflowStateManager(SHAVE_ID);
    manager.skipStage(ProgressStage.UPLOADING_VIDEO);
    manager.startStage(ProgressStage.DOWNLOADING_VIDEO);
    manager.failStage(ProgressStage.DOWNLOADING_VIDEO, "fail");
    // No checkpoint with downloadUrl
    (deps.getOrCreateWorkflowManager as ReturnType<typeof vi.fn>).mockReturnValue(manager);

    const result = await service.retryFromStage(ProgressStage.DOWNLOADING_VIDEO, SHAVE_ID);

    expect(result.success).toBe(false);
    expect(result.error).toContain("download URL not found");
  });
});

// ─── WorkflowCheckpointService (via WorkflowStateManager) ───────────────

describe("WorkflowStateManager checkpoint operations", () => {
  it("creates and retrieves checkpoints", () => {
    const manager = new WorkflowStateManager(SHAVE_ID);
    manager.createCheckpoint(ProgressStage.UPLOADING_VIDEO, { filePath: "/test.mp4" });

    const cp = manager.getCheckpoint(ProgressStage.UPLOADING_VIDEO);
    expect(cp?.filePath).toBe("/test.mp4");
  });

  it("clearAllCheckpoints removes all data", () => {
    const manager = new WorkflowStateManager(SHAVE_ID);
    manager.createCheckpoint(ProgressStage.UPLOADING_VIDEO, { filePath: "/test.mp4" });
    manager.createCheckpoint(ProgressStage.TRANSCRIBING, { transcriptText: "hello" });

    manager.clearAllCheckpoints();

    expect(manager.getCheckpoint(ProgressStage.UPLOADING_VIDEO)).toBeUndefined();
    expect(manager.getCheckpoint(ProgressStage.TRANSCRIBING)).toBeUndefined();
  });

  it("getAllCheckpoints returns all stage checkpoints", () => {
    const manager = new WorkflowStateManager(SHAVE_ID);
    manager.createCheckpoint(ProgressStage.UPLOADING_VIDEO, { filePath: "/a.mp4" });
    manager.createCheckpoint(ProgressStage.TRANSCRIBING, { transcriptText: "hi" });

    const all = manager.getAllCheckpoints();
    expect(all.size).toBe(2);
    expect(all.get(ProgressStage.UPLOADING_VIDEO)?.filePath).toBe("/a.mp4");
    expect(all.get(ProgressStage.TRANSCRIBING)?.transcriptText).toBe("hi");
  });
});
