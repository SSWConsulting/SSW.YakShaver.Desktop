import fs from "node:fs";
import {
  WORKFLOW_STAGE_ORDER,
  ProgressStage as WorkflowProgressStage,
  type WorkflowState,
} from "../../../shared/types/workflow";
import { formatAndReportError } from "../../utils/error-utils";
import type { VideoUploadResult } from "../auth/types";
import type { YouTubeClient } from "../auth/youtube-client";
import { ShaveService } from "../shave/shave-service";
import type { LocalVideoStorageService } from "../video/local-video-storage";
import type { YouTubeDownloadService } from "../video/youtube-service";
import { ingestRecordingAsync } from "./video-ingest";
import type { CheckpointData } from "./workflow-checkpoint-service";
import type { WorkflowStateManager } from "./workflow-state-manager";

export type VideoProcessingContext = {
  filePath: string;
  youtubeResult: VideoUploadResult;
  /** #1062: set when the recording was kept locally because no video host is connected. */
  localFolder?: string;
  shaveId?: string;
  shaveAutoApprove?: boolean;
  /**
   * Optional user-supplied override for the Executing Task prompt, used when retrying after a
   * failure (e.g. a timeout, #698) so the user can steer the retry instead of repeating the same
   * run that got stuck. Only consumed by the EXECUTING_TASK stage.
   */
  customPrompt?: string;
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
  localVideoStorage: LocalVideoStorageService;
  youtubeDownloadService: YouTubeDownloadService;
  processVideoSource: (
    ctx: VideoProcessingContext,
    wm: WorkflowStateManager,
    startFromStage?: keyof WorkflowState,
  ) => Promise<RetryResult>;
  trackTempFile: (path: string, shaveId?: string) => void;
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

  for (const s of WORKFLOW_STAGE_ORDER) {
    const cp = allCheckpoints.get(s);
    if (cp) {
      Object.assign(merged, cp);
    }
    if (s === stage) break;
  }

  return merged;
}

/**
 * Defines which checkpoint fields each stage requires from prior stages.
 * Used to validate checkpoint completeness before resuming from a failed stage.
 */
const STAGE_REQUIRED_INPUTS: Partial<Record<keyof WorkflowState, (keyof CheckpointData)[]>> = {
  [WorkflowProgressStage.TRANSCRIBING]: ["mp3FilePath"],
  [WorkflowProgressStage.OPTIMIZING_TRANSCRIPT]: ["transcript", "transcriptText"],
  [WorkflowProgressStage.ANALYZING_TRANSCRIPT]: ["transcript", "transcriptText"],
  [WorkflowProgressStage.SELECTING_PROMPT]: ["transcriptText", "intermediateOutput"],
  [WorkflowProgressStage.EXECUTING_TASK]: ["transcriptText", "projectDetails"],
  [WorkflowProgressStage.UPDATING_METADATA]: ["mcpResult"],
};

/**
 * Validate that merged checkpoint data contains all required inputs for a stage.
 * Returns the list of missing fields.
 */
export function validateCheckpointData(
  stage: keyof WorkflowState,
  data: CheckpointData,
): { valid: boolean; missing: string[] } {
  const required = STAGE_REQUIRED_INPUTS[stage] ?? [];
  const missing = required.filter((key) => data[key] == null);

  return { valid: missing.length === 0, missing };
}

export class WorkflowRetryService {
  constructor(private deps: WorkflowRetryDeps) {}

  async retryFromStage(
    stage: keyof WorkflowState,
    shaveId?: string,
    customPrompt?: string,
  ): Promise<RetryResult> {
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
        return this.retryFromMiddleStage(workflowManager, checkpoint, stage, shaveId, customPrompt);
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

      // #672/#1062: route the retry through the SAME helper as the first run, so it gets the
      // same success gating and the same local-storage fallback when no video host is connected.
      const { youtubeResult, localFolder } = await ingestRecordingAsync(
        filePath,
        duration,
        this.deps,
        workflowManager,
      );
      workflowManager.createCheckpoint(WorkflowProgressStage.UPLOADING_VIDEO, {
        filePath,
        youtubeResult,
        localFolder,
      });

      this.deps.trackTempFile(filePath, shaveId);

      return this.deps.processVideoSource(
        { filePath, youtubeResult, localFolder, shaveId },
        workflowManager,
      );
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

      const filePath = await this.deps.youtubeDownloadService.downloadVideoToFile(downloadUrl);
      this.deps.trackTempFile(filePath, shaveId);

      workflowManager.completeStage(WorkflowProgressStage.DOWNLOADING_VIDEO, {
        downloadUrl,
        filePath,
        sourceOrigin: "external",
        uploadResult: youtubeResult,
      });

      workflowManager.createCheckpoint(WorkflowProgressStage.DOWNLOADING_VIDEO, {
        filePath,
        youtubeResult,
        downloadUrl,
      });

      return this.deps.processVideoSource({ filePath, youtubeResult, shaveId }, workflowManager);
    } catch (error) {
      const errorMessage = formatAndReportError(error, "retry_download");
      workflowManager.failStage(WorkflowProgressStage.DOWNLOADING_VIDEO, errorMessage);
      return { success: false, error: errorMessage };
    }
  }

  private async retryFromMiddleStage(
    workflowManager: WorkflowStateManager,
    checkpoint: CheckpointData,
    stage: keyof WorkflowState,
    shaveId: string,
    customPrompt?: string,
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
      { filePath, youtubeResult, shaveId, customPrompt },
      workflowManager,
      stage,
    );
  }
}
