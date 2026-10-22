import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProgressStage } from "../../shared/types/workflow";

/**
 * #1062: with no video host connected the recording is kept in a local folder. These cover the
 * two follow-up steps the handler owns: writing the transcript next to it, and renaming the
 * folder to the work item title (repointing the "Uploading Video" stage so Open folder works).
 * Both are best-effort — a disk error must never fail a run whose work item already exists.
 */

const testState = vi.hoisted(() => ({
  saveTranscriptAsync: vi.fn(),
  renameWithTitleAsync: vi.fn(),
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
vi.mock("../services/video/local-video-storage", () => ({
  LocalVideoStorageService: {
    getInstance: () => ({
      saveTranscriptAsync: testState.saveTranscriptAsync,
      renameWithTitleAsync: testState.renameWithTitleAsync,
    }),
  },
}));
vi.mock("../utils/error-utils", () => ({
  formatAndReportError: (error: unknown) =>
    error instanceof Error ? error.message : String(error),
}));

import { ProcessVideoIPCHandlers } from "./process-video-handlers";

interface TestableHandler {
  saveLocalTranscriptAsync(localFolder: string | undefined, transcriptText: string): Promise<void>;
  renameLocalFolderWithTitleAsync(
    localFolder: string | undefined,
    title: string | undefined,
    filePath: string,
    workflowManager: unknown,
  ): Promise<string | undefined>;
}

const FOLDER = "C:/Videos/YakShaver/2026-10-22 0905";
const RENAMED = `${FOLDER} - Login fails`;
const FILE_PATH = "C:/temp/recording.webm";

function createHandler() {
  return new ProcessVideoIPCHandlers() as unknown as TestableHandler;
}

describe("local storage follow-ups (#1062)", () => {
  beforeEach(() => {
    testState.saveTranscriptAsync.mockReset().mockResolvedValue(undefined);
    testState.renameWithTitleAsync.mockReset().mockResolvedValue(RENAMED);
  });

  it("saves the transcript next to a locally kept recording", async () => {
    await createHandler().saveLocalTranscriptAsync(FOLDER, "hello world");

    expect(testState.saveTranscriptAsync).toHaveBeenCalledWith(FOLDER, "hello world");
  });

  it("does nothing for an uploaded recording (no local folder)", async () => {
    await createHandler().saveLocalTranscriptAsync(undefined, "hello world");

    expect(testState.saveTranscriptAsync).not.toHaveBeenCalled();
  });

  it("does not fail the run when the transcript can't be written", async () => {
    testState.saveTranscriptAsync.mockRejectedValue(new Error("disk full"));

    await expect(createHandler().saveLocalTranscriptAsync(FOLDER, "hi")).resolves.toBeUndefined();
  });

  it("renames the folder to the work item title and repoints the upload stage", async () => {
    const workflowManager = { updateStagePayload: vi.fn() };

    const result = await createHandler().renameLocalFolderWithTitleAsync(
      FOLDER,
      "Login fails",
      FILE_PATH,
      workflowManager,
    );

    expect(result).toBe(RENAMED);
    expect(testState.renameWithTitleAsync).toHaveBeenCalledWith(FOLDER, "Login fails");
    expect(workflowManager.updateStagePayload).toHaveBeenCalledWith(
      ProgressStage.UPLOADING_VIDEO,
      expect.objectContaining({ localFolder: RENAMED, sourceOrigin: "local" }),
    );
  });

  it("keeps the original folder when renaming fails", async () => {
    testState.renameWithTitleAsync.mockRejectedValue(new Error("folder in use"));
    const workflowManager = { updateStagePayload: vi.fn() };

    const result = await createHandler().renameLocalFolderWithTitleAsync(
      FOLDER,
      "Login fails",
      FILE_PATH,
      workflowManager,
    );

    expect(result).toBe(FOLDER);
    expect(workflowManager.updateStagePayload).not.toHaveBeenCalled();
  });

  it("skips renaming when there is no local folder or no title", async () => {
    const handler = createHandler();
    const workflowManager = { updateStagePayload: vi.fn() };

    expect(
      await handler.renameLocalFolderWithTitleAsync(undefined, "T", FILE_PATH, workflowManager),
    ).toBeUndefined();
    expect(
      await handler.renameLocalFolderWithTitleAsync(FOLDER, undefined, FILE_PATH, workflowManager),
    ).toBe(FOLDER);
    expect(testState.renameWithTitleAsync).not.toHaveBeenCalled();
  });
});
