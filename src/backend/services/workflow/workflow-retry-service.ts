import fs from "node:fs";
import {
  ProgressStage as WorkflowProgressStage,
  type WorkflowState,
} from "../../../shared/types/workflow";
import { ProgressStage } from "../../types";
import { formatAndReportError } from "../../utils/error-utils";
import type { VideoUploadResult } from "../auth/types";
import type { YouTubeClient } from "../auth/youtube-client";
import { ShaveService } from "../shave/shave-service";
import type { YouTubeDownloadService } from "../video/youtube-service";
import type { CheckpointData } from "./workflow-checkpoint-service";
import type { WorkflowStateManager } from "./workflow-state-manager";

export type VideoProcessingContext = {
  filePath: string;
  youtubeResult: VideoUploadResult;
  shaveId?: string;
};

export type RetryResult = {
  success: boolean;
  youtubeResult?: VideoUploadResult;
  mcpResult?: string | undefined;
  error?: string;
  workflowId?: string;
};

export interface WorkflowRetryDeps {
  youtube: YouTubeClient;
  youtubeDownloadService: YouTubeDownloadService;
  processVideoSource: (
    ctx: VideoProcessingContext,
    wm: WorkflowStateManager,
    startFromStage?: keyof WorkflowState,
  ) => Promise<RetryResult>;
  emitProgress: (stage: string, data?: Record<string, unknown>, shaveId?: string) => void;
  trackTempFile: (path: string) => void;
  getLastVideoFilePath: () => string | undefined;
  getOrCreateWorkflowManager: (shaveId: string) => WorkflowStateManager;
}

/**
 * Resolve checkpoint data for a stage by merging data from all prior stage
 * checkpoints. This ensures retry handlers always have access to outputs from
 * earlier stages (e.g. youtubeResult, mp3FilePath) even if the current stage's
 * checkpoint doesn't explicitly store them.
 */
export function resolveCheckpointData(
  workflowManager: WorkflowStateManager,
  stage: keyof WorkflowState,
): CheckpointData {
  const allCheckpoints = workflowManager.getAllCheckpoints();
  const merged: CheckpointData = {};

  const stageOrder: (keyof WorkflowState)[] = [
    WorkflowProgressStage.UPLOADING_VIDEO,
    WorkflowProgressStage.DOWNLOADING_VIDEO,
    WorkflowProgressStage.CONVERTING_AUDIO,
    WorkflowProgressStage.TRANSCRIBING,
    WorkflowProgressStage.ANALYZING_TRANSCRIPT,
    WorkflowProgressStage.SELECTING_PROMPT,
    WorkflowProgressStage.EXECUTING_TASK,
    WorkflowProgressStage.UPDATING_METADATA,
  ];

  for (const s of stageOrder) {
    const cp = allCheckpoints.get(s);
    if (cp) {
      Object.assign(merged, cp);
    }
    if (s === stage) break;
  }

  return merged;
}

export class WorkflowRetryService {
  constructor(private deps: WorkflowRetryDeps) {}

  async retryFromStage(stage: keyof WorkflowState, shaveId?: string): Promise<RetryResult> {
    if (!shaveId) {
      return { success: false, error: "Shave ID is required for retry" };
    }

    const workflowManager = this.deps.getOrCreateWorkflowManager(shaveId);

    const canProceed = workflowManager.prepareStageForRetry(stage);
    if (!canProceed) {
      return {
        success: false,
        error: `Cannot retry stage ${stage}. It may not be in a failed state.`,
      };
    }

    const checkpoint = resolveCheckpointData(workflowManager, stage);

    switch (stage) {
      case "uploading_video":
        return this.retryUploadingVideo(workflowManager, checkpoint, shaveId);
      case "downloading_video":
        return this.retryDownloadingVideo(workflowManager, checkpoint, shaveId);
      default:
        return this.retryFromMiddleStage(workflowManager, checkpoint, stage, shaveId);
    }
  }

  private async retryUploadingVideo(
    workflowManager: WorkflowStateManager,
    checkpoint: CheckpointData,
    shaveId: string,
  ): Promise<RetryResult> {
    try {
      workflowManager.startStage(WorkflowProgressStage.UPLOADING_VIDEO);

      const filePath = checkpoint.filePath || this.deps.getLastVideoFilePath();
      if (!filePath || !fs.existsSync(filePath)) {
        throw new Error("Original video file not found. Cannot retry upload.");
      }

      let duration: number | undefined;
      try {
        const shaveService = ShaveService.getInstance();
        const videoSource = shaveService.getShaveVideoSourceInfo(shaveId);
        duration = videoSource?.durationSeconds ?? undefined;
      } catch {
        // Duration is optional, continue without it
      }

      this.deps.emitProgress(ProgressStage.UPLOADING_SOURCE, { sourceOrigin: "upload" }, shaveId);

      const youtubeResult = await this.deps.youtube.uploadVideo(filePath);

      if (youtubeResult.success && youtubeResult.data && duration) {
        youtubeResult.data.duration = duration;
      }

      workflowManager.completeStage(WorkflowProgressStage.UPLOADING_VIDEO, youtubeResult.data?.url);
      this.deps.emitProgress(
        ProgressStage.UPLOAD_COMPLETED,
        { uploadResult: youtubeResult, sourceOrigin: youtubeResult.origin },
        shaveId,
      );

      workflowManager.createCheckpoint(WorkflowProgressStage.UPLOADING_VIDEO, {
        filePath,
        youtubeResult,
      });

      this.deps.trackTempFile(filePath);

      return this.deps.processVideoSource({ filePath, youtubeResult, shaveId }, workflowManager);
    } catch (error) {
      const errorMessage = formatAndReportError(error, "retry_upload");
      workflowManager.failStage(WorkflowProgressStage.UPLOADING_VIDEO, errorMessage);
      return { success: false, error: errorMessage };
    }
  }

  private async retryDownloadingVideo(
    workflowManager: WorkflowStateManager,
    checkpoint: CheckpointData,
    shaveId: string,
  ): Promise<RetryResult> {
    try {
      workflowManager.startStage(WorkflowProgressStage.DOWNLOADING_VIDEO);

      const downloadUrl = checkpoint.downloadUrl;
      if (!downloadUrl) {
        throw new Error("Original download URL not found. Cannot retry download.");
      }

      const youtubeResult = await this.deps.youtubeDownloadService.getVideoMetadata(downloadUrl);
      this.deps.emitProgress(
        ProgressStage.UPLOAD_COMPLETED,
        { uploadResult: youtubeResult, sourceOrigin: "external" },
        shaveId,
      );
      this.deps.emitProgress(
        ProgressStage.DOWNLOADING_SOURCE,
        { sourceOrigin: "external" },
        shaveId,
      );

      const filePath = await this.deps.youtubeDownloadService.downloadVideoToFile(downloadUrl);
      this.deps.trackTempFile(filePath);

      workflowManager.completeStage(WorkflowProgressStage.DOWNLOADING_VIDEO);

      workflowManager.createCheckpoint(WorkflowProgressStage.DOWNLOADING_VIDEO, {
        filePath,
        youtubeResult,
        downloadUrl,
      });

      return this.deps.processVideoSource({ filePath, youtubeResult, shaveId }, workflowManager);
    } catch (error) {
      const errorMessage = formatAndReportError(error, "retry_download");
      workflowManager.failStage(WorkflowProgressStage.DOWNLOADING_VIDEO, errorMessage);
      this.deps.emitProgress(ProgressStage.ERROR, { error: errorMessage }, shaveId);
      return { success: false, error: errorMessage };
    }
  }

  private async retryFromMiddleStage(
    workflowManager: WorkflowStateManager,
    checkpoint: CheckpointData,
    stage: keyof WorkflowState,
    shaveId: string,
  ): Promise<RetryResult> {
    const filePath = checkpoint.filePath || this.deps.getLastVideoFilePath();
    const youtubeResult = checkpoint.youtubeResult;

    if (!filePath || !youtubeResult) {
      return {
        success: false,
        error: "Previous stage checkpoint data not found. Cannot retry.",
      };
    }

    return this.deps.processVideoSource(
      { filePath, youtubeResult, shaveId },
      workflowManager,
      stage,
    );
  }
}
