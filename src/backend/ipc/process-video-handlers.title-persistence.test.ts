import { describe, expect, it, vi } from "vitest";
import { ProgressStage } from "../../shared/types/workflow";

const testState = vi.hoisted(() => ({
  updateShave: vi.fn(),
  intermediateOutput: JSON.stringify({
    title: "Canonical Shave title",
    taskType: "create_issue",
    detectedLanguage: "en-US",
    formattedContent: "Create an issue",
    mentionedEntities: [],
    contextKeywords: [],
    uncertainTerms: [],
  }),
}));

vi.mock("electron", () => ({ ipcMain: { handle: vi.fn() } }));
vi.mock("node:fs", () => ({ default: { existsSync: vi.fn(() => true) } }));
vi.mock("../services/auth/youtube-client", () => ({
  YouTubeClient: { getInstance: () => ({}) },
}));
vi.mock("../services/ffmpeg/ffmpeg-service", () => ({
  FFmpegService: { getInstance: () => ({}) },
}));
vi.mock("../services/video/video-metadata-builder", () => ({ VideoMetadataBuilder: vi.fn() }));
vi.mock("../services/video/youtube-service", () => ({
  YouTubeDownloadService: { getInstance: () => ({}) },
}));
vi.mock("../services/shave/shave-service", () => ({
  ShaveService: { getInstance: () => ({ updateShave: testState.updateShave }) },
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
vi.mock("../services/workflow/executing-task-timeout", () => ({
  runManualLoopWithTimeout: vi.fn(() => Promise.reject(new Error("stop after title write"))),
}));
vi.mock("../services/workflow/mcp-workflow-adapter", () => ({
  McpWorkflowAdapter: vi.fn().mockImplementation(function McpWorkflowAdapter() {
    return { onStep: vi.fn(), discard: vi.fn() };
  }),
}));
vi.mock("../services/workflow/video-metadata-persistence", () => ({
  applyPortalVideoFields: vi.fn(),
  applyShaveTitleToOwnedVideoMetadata: vi.fn(),
  applyVideoMetadataPersistence: vi.fn(),
}));
vi.mock("../services/workflow/workflow-retry-service", () => ({
  WorkflowRetryService: vi.fn().mockImplementation(function WorkflowRetryService() {
    return { retryFromStage: vi.fn() };
  }),
  resolveCheckpointData: vi.fn(() => ({
    transcript: [{ text: "Create an issue" }],
    transcriptText: "Create an issue",
    optimizedTranscriptText: "Create an issue",
    intermediateOutput: testState.intermediateOutput,
    projectDetails: { name: "Test", selectionReason: "Test", projectSource: "local" },
  })),
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
    workflowManager: {
      getWorkflowId(): string;
      startStage(stage: string): void;
      getStepState(stage: string): { status: "in_progress" };
      failStage(stage: string, error: string): void;
    },
    startFromStage: ProgressStage,
  ): Promise<unknown>;
}

describe("resumed Shave title persistence", () => {
  it("keeps the analyzed title when resuming from EXECUTING_TASK", async () => {
    const handler = new ProcessVideoIPCHandlers() as unknown as TestableHandler;
    const workflowManager = {
      getWorkflowId: () => "shave-1",
      startStage: vi.fn(),
      getStepState: vi.fn(() => ({ status: "in_progress" as const })),
      failStage: vi.fn(),
    };

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
      ProgressStage.EXECUTING_TASK,
    );

    expect(testState.updateShave).toHaveBeenCalledWith("shave-1", {
      title: "Canonical Shave title",
    });
    expect(testState.updateShave).not.toHaveBeenCalledWith("shave-1", {
      title: "Uploaded Video",
    });
  });
});
