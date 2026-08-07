import { describe, expect, it, vi } from "vitest";
import { ProgressStage } from "../../shared/types/workflow";

/**
 * Cross-stage wiring for the reconciled work item title.
 *
 * UPDATING_METADATA sits OUTSIDE the EXECUTING_TASK block and can be retried on its own, so the
 * title has to survive in the checkpoint rather than in a local variable. That exact shape has
 * already produced two bugs in this area — a resume skipping the stage that computed the title,
 * and a metadata-only retry losing it — and neither was reachable by the pure-function tests.
 */

const testState = vi.hoisted(() => ({
  updateShave: vi.fn(),
  updateVideoMetadata: vi.fn(),
  buildMetadata: vi.fn(),
  resolveAsync: vi.fn(),
  checkpoint: {} as Record<string, unknown>,
}));

vi.mock("electron", () => ({ ipcMain: { handle: vi.fn() } }));
vi.mock("node:fs", () => ({ default: { existsSync: vi.fn(() => true) } }));
vi.mock("../services/auth/youtube-client", () => ({
  YouTubeClient: {
    getInstance: () => ({ updateVideoMetadata: testState.updateVideoMetadata }),
  },
}));
vi.mock("../services/ffmpeg/ffmpeg-service", () => ({
  FFmpegService: { getInstance: () => ({}) },
}));
vi.mock("../services/video/video-metadata-builder", () => ({
  VideoMetadataBuilder: vi.fn().mockImplementation(function VideoMetadataBuilder() {
    return { build: testState.buildMetadata };
  }),
}));
vi.mock("../services/video/youtube-service", () => ({
  YouTubeDownloadService: { getInstance: () => ({}) },
}));
vi.mock("../services/shave/shave-service", () => ({
  ShaveService: {
    getInstance: () => ({
      updateShave: testState.updateShave,
      // Already has an embed URL, so the #808 backstop is a no-op and stays out of the way.
      getShaveById: vi.fn(() => ({ videoEmbedUrl: "https://youtube.com/watch?v=abc" })),
      attachVideoSourceToShave: vi.fn(),
      markShaveVideoFilesAsDeleted: vi.fn(),
    }),
  },
}));
vi.mock("../services/storage/llm-storage", () => ({
  LlmStorage: { getInstance: () => ({ getLLMConfig: vi.fn(() => null) }) },
}));
vi.mock("../services/storage/user-settings-storage", () => ({
  UserSettingsStorage: {
    getInstance: () => ({ getSettingsAsync: vi.fn(() => ({ executingTaskTimeoutMs: 1000 })) }),
  },
}));
vi.mock("../services/mcp/mcp-orchestrator", () => ({
  MCPOrchestrator: { getInstanceAsync: vi.fn(() => ({})) },
}));
vi.mock("../services/mcp/mcp-server-manager", () => ({
  MCPServerManager: { getInstanceAsync: vi.fn(async () => ({})) },
}));
vi.mock("../services/backlog/backlog-item-resolver", () => ({
  McpBacklogItemResolver: vi.fn().mockImplementation(function McpBacklogItemResolver() {
    return { resolveAsync: testState.resolveAsync };
  }),
}));
vi.mock("../services/workflow/mcp-workflow-adapter", () => ({
  McpWorkflowAdapter: vi.fn().mockImplementation(function McpWorkflowAdapter() {
    return { onStep: vi.fn(), discard: vi.fn() };
  }),
}));
vi.mock("../services/workflow/workflow-retry-service", () => ({
  WorkflowRetryService: vi.fn().mockImplementation(function WorkflowRetryService() {
    return { retryFromStage: vi.fn() };
  }),
  resolveCheckpointData: vi.fn(() => testState.checkpoint),
  validateCheckpointData: vi.fn(() => ({ valid: true, missing: [] })),
}));
vi.mock("../utils/error-utils", () => ({
  formatAndReportError: (error: unknown) =>
    error instanceof Error ? error.message : String(error),
}));

import type { VideoProcessingContext } from "../services/workflow/workflow-retry-service";
import { ProcessVideoIPCHandlers } from "./process-video-handlers";

interface TestableHandler {
  processVideoSource(
    context: VideoProcessingContext,
    workflowManager: unknown,
    startFromStage: ProgressStage,
  ): Promise<unknown>;
}

const RESUMED_TITLE = "🐛 The title that is actually on the issue";

function makeWorkflowManager() {
  return {
    getWorkflowId: () => "shave-1",
    startStage: vi.fn(),
    completeStage: vi.fn(),
    skipStage: vi.fn(),
    failStage: vi.fn(),
    createCheckpoint: vi.fn(),
    updateStagePayload: vi.fn(),
    getStepState: vi.fn(() => ({ status: "in_progress" as const })),
  };
}

async function runMetadataOnlyRetry() {
  const handler = new ProcessVideoIPCHandlers() as unknown as TestableHandler;
  const workflowManager = makeWorkflowManager();

  await handler.processVideoSource(
    {
      filePath: "C:\\temp\\recording.mp4",
      shaveId: "shave-1",
      youtubeResult: {
        success: true,
        origin: "upload",
        data: {
          title: "Uploaded Video",
          description: "Uploaded video description",
          url: "https://youtube.com/watch?v=abc",
          videoId: "abc",
        },
      },
    },
    workflowManager,
    ProgressStage.UPDATING_METADATA,
  );

  return workflowManager;
}

describe("resuming UPDATING_METADATA on its own", () => {
  it("gives the video the checkpointed work item title without re-reading it", async () => {
    testState.checkpoint = {
      mcpResult: "created the issue",
      finalOutput: JSON.stringify({ Status: "Success", Title: "Model's reported title" }),
      effectiveTitle: RESUMED_TITLE,
    };
    testState.buildMetadata.mockResolvedValue({
      snippet: { title: "Title the model wrote for the video" },
      metadata: { title: "Title the model wrote for the video" },
    });
    testState.updateVideoMetadata.mockResolvedValue({ success: true, origin: "upload", data: {} });

    const workflowManager = await runMetadataOnlyRetry();

    // The video carries the work item's title, not the metadata builder's own.
    expect(testState.updateVideoMetadata).toHaveBeenCalledWith(
      "abc",
      expect.objectContaining({ title: RESUMED_TITLE }),
      "upload",
    );
    // And the stage payload the user sees agrees with what was sent.
    expect(workflowManager.completeStage).toHaveBeenCalledWith(
      ProgressStage.UPDATING_METADATA,
      expect.objectContaining({ title: RESUMED_TITLE }),
    );
    // EXECUTING_TASK did not run, so nothing may have gone back out to the backlog platform.
    expect(testState.resolveAsync).not.toHaveBeenCalled();
  });

  it("leaves the video's own title alone when the checkpoint has none", async () => {
    // A shave recorded before this feature existed resumes without an effectiveTitle; the metadata
    // builder's title must survive rather than being blanked.
    testState.checkpoint = { mcpResult: "created the issue" };
    testState.buildMetadata.mockResolvedValue({
      snippet: { title: "Title the model wrote for the video" },
      metadata: { title: "Title the model wrote for the video" },
    });
    testState.updateVideoMetadata.mockResolvedValue({ success: true, origin: "upload", data: {} });

    await runMetadataOnlyRetry();

    expect(testState.updateVideoMetadata).toHaveBeenCalledWith(
      "abc",
      expect.objectContaining({ title: "Title the model wrote for the video" }),
      "upload",
    );
  });
});
