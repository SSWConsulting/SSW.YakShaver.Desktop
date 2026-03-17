import fs from "node:fs";
import { BrowserWindow, type IpcMainInvokeEvent, ipcMain } from "electron";
import tmp from "tmp";
import { z } from "zod";
import type { TranscriptSegment } from "../../shared/types/transcript";
import {
  ProgressStage as WorkflowProgressStage,
  type WorkflowState,
} from "../../shared/types/workflow";
import { INITIAL_SUMMARY_PROMPT, TASK_EXECUTION_PROMPT } from "../constants/prompts";
import { MicrosoftAuthService } from "../services/auth/microsoft-auth";
import type { VideoUploadResult } from "../services/auth/types";
import { YouTubeClient } from "../services/auth/youtube-client";
import { FFmpegService } from "../services/ffmpeg/ffmpeg-service";
import { LanguageModelProvider } from "../services/mcp/language-model-provider";
import { MCPOrchestrator } from "../services/mcp/mcp-orchestrator";
import { TranscriptionModelProvider } from "../services/mcp/transcription-model-provider";
import { SendWorkItemDetailsToPortal, WorkItemDtoSchema } from "../services/portal/actions";
import type { ProjectDto } from "../services/prompt/prompt-manager";
import { ShaveService } from "../services/shave/shave-service";
import { VideoMetadataBuilder } from "../services/video/video-metadata-builder";
import { YouTubeDownloadService } from "../services/video/youtube-service";
import { McpWorkflowAdapter } from "../services/workflow/mcp-workflow-adapter";
import { PromptSelectionService } from "../services/workflow/prompt-selection-service";
import type { CheckpointData } from "../services/workflow/workflow-checkpoint-service";
import { WorkflowStateManager } from "../services/workflow/workflow-state-manager";
import { ProgressStage } from "../types";
import { formatAndReportError } from "../utils/error-utils";
import { IPC_CHANNELS } from "./channels";

type VideoProcessingContext = {
  filePath: string;
  youtubeResult: VideoUploadResult;
  shaveId?: string;
};

type RetryResult = {
  success: boolean;
  youtubeResult?: VideoUploadResult;
  mcpResult?: string | undefined;
  error?: string;
};

export const TranscriptSummarySchema = z.object({
  taskType: z.string(),
  detectedLanguage: z
    .string()
    .regex(/^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})*$/, "Must be a valid BCP 47 language tag"),
  formattedContent: z.string(),
  mentionedEntities: z.array(z.string()).optional().default([]),
  contextKeywords: z.array(z.string()).optional().default([]),
  uncertainTerms: z.array(z.string()).optional().default([]),
});

export class ProcessVideoIPCHandlers {
  private readonly youtube = YouTubeClient.getInstance();
  private ffmpegService = FFmpegService.getInstance();
  private readonly metadataBuilder: VideoMetadataBuilder;
  private readonly youtubeDownloadService = YouTubeDownloadService.getInstance();
  private lastVideoFilePath: string | undefined;
  private tempFilesToCleanup: string[] = [];
  private workflowManagers: Map<string, WorkflowStateManager> = new Map();

  constructor() {
    this.metadataBuilder = new VideoMetadataBuilder();
    this.registerHandlers();
  }

  private registerHandlers(): void {
    ipcMain.handle(
      IPC_CHANNELS.PROCESS_VIDEO_FILE,
      async (_event, filePath?: string, shaveId?: string) => {
        if (!filePath) {
          throw new Error("video-process-handler: Video file path is required");
        }

        return await this.processFileVideo(filePath, shaveId);
      },
    );

    ipcMain.handle(
      IPC_CHANNELS.PROCESS_VIDEO_URL,
      async (_event, url?: string, shaveId?: string) => {
        if (!url) {
          throw new Error("video-process-handler: Video URL is required");
        }

        return await this.processUrlVideo(url, shaveId);
      },
    );

    // Retry video pipeline
    ipcMain.handle(
      IPC_CHANNELS.RETRY_VIDEO,
      async (
        _event: IpcMainInvokeEvent,
        intermediateOutput: string,
        videoUploadResult: VideoUploadResult,
        shaveId?: string,
      ) => {
        const notify = (stage: string, data?: Record<string, unknown>) => {
          this.emitProgress(stage, data, shaveId);
        };

        try {
          const workflowManager = new WorkflowStateManager(shaveId);
          workflowManager.startStage(WorkflowProgressStage.SELECTING_PROMPT);

          const languageModelProvider = await LanguageModelProvider.getInstance();

          const projectDetails =
            await PromptSelectionService.getInstance().getConfirmedProjectDetails(
              languageModelProvider,
              intermediateOutput,
            );

          const { desktopAgentProjectPrompt, projectMetaData } =
            this.formatProjectDetails(projectDetails);

          workflowManager.completeStage(WorkflowProgressStage.SELECTING_PROMPT, projectDetails);
          workflowManager.startStage(WorkflowProgressStage.EXECUTING_TASK);
          notify(ProgressStage.EXECUTING_TASK);

          const serverFilter = projectDetails?.selectedMcpServerIds;

          const filePath =
            this.lastVideoFilePath && fs.existsSync(this.lastVideoFilePath)
              ? this.lastVideoFilePath
              : undefined;

          const mcpAdapter = new McpWorkflowAdapter(workflowManager);

          const orchestrator = await MCPOrchestrator.getInstanceAsync();
          const mcpResult = await orchestrator.manualLoopAsync(
            intermediateOutput,
            videoUploadResult,
            {
              projectMetaData,
              desktopAgentProjectPrompt,
              videoFilePath: filePath,
              serverFilter,
              onStep: mcpAdapter.onStep,
            },
          );

          const finalOutput = await this.formatFinalResult(mcpResult);
          mcpAdapter.complete(mcpResult);

          notify(ProgressStage.COMPLETED, {
            mcpResult,
            finalOutput,
          });
          return { success: true, finalOutput };
        } catch (error) {
          const errorMessage = formatAndReportError(error, "retry_video_processing");
          notify(ProgressStage.ERROR, { error: errorMessage });
          return { success: false, error: errorMessage };
        }
      },
    );

    // Retry from a specific failed stage
    ipcMain.handle(
      IPC_CHANNELS.WORKFLOW_RETRY_FROM_STAGE,
      async (_event: IpcMainInvokeEvent, stage: keyof WorkflowState, shaveId?: string) => {
        try {
          return await this.retryFromStage(stage, shaveId);
        } catch (error) {
          const errorMessage = formatAndReportError(error, "retry_from_stage");
          return { success: false, error: errorMessage };
        }
      },
    );

    // Get retry status for all failed stages
    ipcMain.handle(IPC_CHANNELS.WORKFLOW_GET_RETRY_STATUS, async (_event, shaveId?: string) => {
      if (!shaveId) {
        return { success: false, error: "Shave ID is required" };
      }

      try {
        const workflowManager = this.getOrCreateWorkflowManager(shaveId);
        const retryableStages = workflowManager.getRetryableFailedStages();

        return {
          success: true,
          stages: retryableStages,
        };
      } catch (error) {
        const errorMessage = formatAndReportError(error, "get_retry_status");
        return { success: false, error: errorMessage };
      }
    });

    // Cancel/clear retry state for a workflow
    ipcMain.handle(IPC_CHANNELS.WORKFLOW_CANCEL_RETRY, async (_event, shaveId?: string) => {
      if (!shaveId) {
        return { success: false, error: "Shave ID is required" };
      }

      try {
        const workflowManager = this.workflowManagers.get(shaveId);
        if (workflowManager) {
          workflowManager.clearAllCheckpoints();
        }
        this.cleanupTempFiles();
        return { success: true };
      } catch (error) {
        const errorMessage = formatAndReportError(error, "cancel_retry");
        return { success: false, error: errorMessage };
      }
    });
  }

  private async processFileVideo(filePath: string, shaveId?: string) {
    const notify = (stage: string, data?: Record<string, unknown>) => {
      this.emitProgress(stage, data, shaveId);
    };

    // check file exists
    if (!fs.existsSync(filePath)) {
      throw new Error("video-process-handler: Video file does not exist");
    }

    const workflowManager = this.getOrCreateWorkflowManager(shaveId || crypto.randomUUID());
    this.workflowManagers.set(workflowManager.getWorkflowId(), workflowManager);

    workflowManager.startStage(WorkflowProgressStage.UPLOADING_VIDEO);
    workflowManager.skipStage(WorkflowProgressStage.DOWNLOADING_VIDEO);

    // Get video source info for duration if shaveId exists
    let duration: number | undefined;
    if (shaveId) {
      const shaveService = ShaveService.getInstance();
      const videoSource = shaveService.getShaveVideoSourceInfo(shaveId);
      duration = videoSource?.durationSeconds ?? undefined;
    }

    // upload to YouTube
    notify(ProgressStage.UPLOADING_SOURCE, {
      sourceOrigin: "upload",
    });

    try {
      this.lastVideoFilePath = filePath;
      this.trackTempFile(filePath);

      const youtubeResult = await this.youtube.uploadVideo(filePath);

      if (youtubeResult.success && youtubeResult.data && duration) {
        youtubeResult.data.duration = duration;
      }

      workflowManager.completeStage(WorkflowProgressStage.UPLOADING_VIDEO, youtubeResult.data?.url);

      // Create checkpoint after successful upload
      workflowManager.createCheckpoint(WorkflowProgressStage.UPLOADING_VIDEO, {
        filePath,
        youtubeResult,
      });

      notify(ProgressStage.UPLOAD_COMPLETED, {
        uploadResult: youtubeResult,
        sourceOrigin: youtubeResult.origin,
      });

      return await this.processVideoSource(
        {
          filePath,
          youtubeResult,
          shaveId,
        },
        workflowManager,
      );
    } catch (uploadError) {
      const errorMessage = formatAndReportError(uploadError, "video_upload");
      workflowManager.failStage(WorkflowProgressStage.UPLOADING_VIDEO, errorMessage);
      return { success: false, error: errorMessage };
    }
  }

  private async processUrlVideo(url: string, shaveId?: string) {
    const notify = (stage: string, data?: Record<string, unknown>) => {
      this.emitProgress(stage, data, shaveId);
    };

    const workflowManager = this.getOrCreateWorkflowManager(shaveId || crypto.randomUUID());
    this.workflowManagers.set(workflowManager.getWorkflowId(), workflowManager);

    workflowManager.skipStage(WorkflowProgressStage.UPLOADING_VIDEO);
    workflowManager.startStage(WorkflowProgressStage.DOWNLOADING_VIDEO);
    workflowManager.skipStage(WorkflowProgressStage.UPDATING_METADATA);

    try {
      const youtubeResult = await this.youtubeDownloadService.getVideoMetadata(url);
      notify(ProgressStage.UPLOAD_COMPLETED, {
        uploadResult: youtubeResult,
        sourceOrigin: "external",
      });
      notify(ProgressStage.DOWNLOADING_SOURCE, {
        sourceOrigin: "external",
      });
      const filePath = await this.youtubeDownloadService.downloadVideoToFile(url);
      this.trackTempFile(filePath);
      this.lastVideoFilePath = filePath;

      workflowManager.completeStage(WorkflowProgressStage.DOWNLOADING_VIDEO);

      // Create checkpoint after successful download
      workflowManager.createCheckpoint(WorkflowProgressStage.DOWNLOADING_VIDEO, {
        filePath,
        youtubeResult,
        downloadUrl: url,
      });
      return await this.processVideoSource(
        {
          filePath,
          youtubeResult,
          shaveId,
        },
        workflowManager,
      );
    } catch (error) {
      const errorMessage = formatAndReportError(error, "video_download");
      workflowManager.failStage(WorkflowProgressStage.DOWNLOADING_VIDEO, errorMessage);
      notify(ProgressStage.ERROR, { error: errorMessage });
      return { success: false, error: errorMessage };
    }
  }

  private async processVideoSource(
    { filePath, youtubeResult, shaveId }: VideoProcessingContext,
    workflowManager: WorkflowStateManager,
  ) {
    // check file exists
    if (!fs.existsSync(filePath)) {
      throw new Error("video-process-handler: Video file does not exist");
    }

    const notify = (stage: string, data?: Record<string, unknown>) => {
      this.emitProgress(stage, data, shaveId);
    };

    try {
      this.lastVideoFilePath = filePath;
      workflowManager.startStage(WorkflowProgressStage.CONVERTING_AUDIO);
      notify(ProgressStage.CONVERTING_AUDIO);

      const hasAudio = await this.ffmpegService.hasAudibleAudio(filePath);
      if (!hasAudio) {
        const errorMessage =
          "No audio detected in this video. Please re-record and make sure the correct microphone is selected and unmuted.";
        workflowManager.failStage(WorkflowProgressStage.CONVERTING_AUDIO, errorMessage);
        notify(ProgressStage.ERROR, { error: errorMessage });
        return { success: false, error: errorMessage };
      }

      const mp3FilePath = await this.convertVideoToMp3(filePath);
      this.trackTempFile(mp3FilePath);

      workflowManager.completeStage(WorkflowProgressStage.CONVERTING_AUDIO);

      // Create checkpoint for potential retry
      workflowManager.createCheckpoint(WorkflowProgressStage.CONVERTING_AUDIO, {
        filePath,
        mp3FilePath,
        hasAudio: true,
        youtubeResult,
      });

      const transcriptionModelProvider = await TranscriptionModelProvider.getInstance();

      workflowManager.startStage(WorkflowProgressStage.TRANSCRIBING);
      notify(ProgressStage.TRANSCRIBING);
      const transcript = await transcriptionModelProvider.transcribeAudio(mp3FilePath);
      const transcriptText = transcript.map((seg) => seg.text).join("");

      if (!transcriptText.trim()) {
        const errorMessage =
          "No speech detected in this recording. Please re-record and check your microphone and audio levels.";
        workflowManager.failStage(WorkflowProgressStage.TRANSCRIBING, errorMessage);
        notify(ProgressStage.ERROR, { error: errorMessage });
        return { success: false, error: errorMessage };
      }

      notify(ProgressStage.TRANSCRIPTION_COMPLETED, { transcript });

      workflowManager.completeStage(WorkflowProgressStage.TRANSCRIBING, transcriptText);

      // Create checkpoint for potential retry
      workflowManager.createCheckpoint(WorkflowProgressStage.TRANSCRIBING, {
        filePath,
        transcript,
        transcriptText,
        mp3FilePath,
        youtubeResult,
      });

      workflowManager.startStage(WorkflowProgressStage.ANALYZING_TRANSCRIPT);
      notify(ProgressStage.GENERATING_TASK);

      const languageModelProvider = await LanguageModelProvider.getInstance();

      const userPrompt = `Process the following transcript into a structured JSON object:

      ${transcriptText}`;

      const intermediateOutput = await languageModelProvider.generateJson(
        userPrompt,
        INITIAL_SUMMARY_PROMPT,
      );

      workflowManager.completeStage(WorkflowProgressStage.ANALYZING_TRANSCRIPT, intermediateOutput);

      // Create checkpoint for potential retry
      workflowManager.createCheckpoint(WorkflowProgressStage.ANALYZING_TRANSCRIPT, {
        filePath,
        transcript,
        transcriptText,
        mp3FilePath,
        youtubeResult,
        intermediateOutput,
      });

      workflowManager.startStage(WorkflowProgressStage.SELECTING_PROMPT);

      // Select project prompt based on transcript
      const projectDetails = await PromptSelectionService.getInstance().getConfirmedProjectDetails(
        languageModelProvider,
        transcriptText,
      );

      const { desktopAgentProjectPrompt, projectMetaData } =
        this.formatProjectDetails(projectDetails);

      workflowManager.completeStage(WorkflowProgressStage.SELECTING_PROMPT, projectDetails);

      // Create checkpoint for potential retry
      workflowManager.createCheckpoint(WorkflowProgressStage.SELECTING_PROMPT, {
        filePath,
        transcript,
        transcriptText,
        mp3FilePath,
        youtubeResult,
        intermediateOutput,
        projectDetails: projectDetails
          ? {
              name: projectDetails.name,
              description: projectDetails.description,
              desktopAgentProjectPrompt: projectDetails.desktopAgentProjectPrompt,
              selectionReason: projectDetails.selectionReason,
              selectedMcpServerIds: projectDetails.selectedMcpServerIds,
            }
          : undefined,
        projectMetaData,
        desktopAgentProjectPrompt,
      });

      workflowManager.startStage(WorkflowProgressStage.EXECUTING_TASK);

      notify(ProgressStage.EXECUTING_TASK, { transcriptText, intermediateOutput });

      const serverFilter = projectDetails?.selectedMcpServerIds;

      const mcpAdapter = new McpWorkflowAdapter(workflowManager, {
        transcriptText,
        intermediateOutput,
      });

      const orchestrator = await MCPOrchestrator.getInstanceAsync();
      const mcpResult = await orchestrator.manualLoopAsync(transcriptText, youtubeResult, {
        projectMetaData,
        desktopAgentProjectPrompt,
        videoFilePath: filePath,
        serverFilter,
        onStep: mcpAdapter.onStep,
      });

      const finalOutput = await this.formatFinalResult(mcpResult);
      mcpAdapter.complete(mcpResult);

      // if user logged in, send work item details to the portal
      if (mcpResult && (await MicrosoftAuthService.getInstance().isAuthenticated())) {
        const objectResult = await orchestrator.convertToObjectAsync(mcpResult, WorkItemDtoSchema);
        const portalResult = await SendWorkItemDetailsToPortal(
          WorkItemDtoSchema.parse(objectResult),
        );
        if (!portalResult.success) {
          console.warn("[ProcessVideo] Portal submission failed:", portalResult.error);
          const errorMessage = formatAndReportError(portalResult.error, "portal_submission");
          notify(ProgressStage.ERROR, { error: errorMessage });
          workflowManager.failStage(WorkflowProgressStage.UPDATING_METADATA, errorMessage);
        } else if (shaveId) {
          try {
            const shaveService = ShaveService.getInstance();
            shaveService.updateShave(shaveId, { portalWorkItemId: portalResult.workItemId });
          } catch (savePortalIdError) {
            console.warn("[ProcessVideo] Failed to persist portal work item id", savePortalIdError);
          }
        }
      }

      let metadataUpdateError: string | undefined;

      if (youtubeResult.origin !== "external" && youtubeResult.success) {
        const videoId = youtubeResult.data?.videoId;
        if (videoId) {
          try {
            notify(ProgressStage.UPDATING_METADATA);
            workflowManager.updateStagePayload(
              WorkflowProgressStage.UPDATING_METADATA,
              null,
              "in_progress",
            );
            const metadata = await this.metadataBuilder.build({
              transcript,
              intermediateOutput,
              executionHistory: JSON.stringify(transcript ?? [], null, 2),
              finalResult: mcpResult ?? undefined,
            });
            notify(ProgressStage.UPDATING_METADATA, {
              metadataPreview: metadata.metadata,
            });
            const updateResult = await this.youtube.updateVideoMetadata(
              videoId,
              metadata.snippet,
              youtubeResult.origin,
            );
            if (updateResult.success) {
              youtubeResult = updateResult;
              workflowManager.completeStage(
                WorkflowProgressStage.UPDATING_METADATA,
                metadata.metadata,
              );
            } else {
              throw new Error(
                `[ProcessVideo] YouTube metadata update failed: ${updateResult.error || "Unknown error"}`,
              );
            }
          } catch (metadataError) {
            console.warn("Metadata update failed", metadataError);
            const metadataErrorMsg = formatAndReportError(metadataError, "metadata_update");
            workflowManager.failStage(WorkflowProgressStage.UPDATING_METADATA, metadataErrorMsg);
            metadataUpdateError = metadataErrorMsg;
          }
        }
      }

      notify(ProgressStage.COMPLETED, {
        transcript,
        intermediateOutput,
        mcpResult,
        finalOutput,
        uploadResult: youtubeResult,
        metadataUpdateError,
      });

      // Clean up temp files on successful completion
      this.cleanupTempFiles();

      return { success: true, youtubeResult, mcpResult };
    } catch (error) {
      const errorMessage = formatAndReportError(error, "video_processing");
      notify(ProgressStage.ERROR, { error: errorMessage });
      return { success: false, error: errorMessage };
    } finally {
      // Note: Temp files are NOT cleaned up here on failure
      // They are preserved for potential retry and cleaned up only on success
      // via cleanupTempFiles() or when user cancels the workflow
      try {
        // Mark video files as deleted in database if shave exists
        if (shaveId) {
          try {
            const shaveService = ShaveService.getInstance();
            shaveService.markShaveVideoFilesAsDeleted(shaveId);
          } catch (dbError) {
            console.warn("[ProcessVideo] Failed to mark video files as deleted", dbError);
          }
        }
      } catch (cleanupError) {
        console.warn("[ProcessVideo] Failed to update database", cleanupError);
      }
    }
  }

  private async convertVideoToMp3(inputPath: string): Promise<string> {
    const outputFilePath = tmp.tmpNameSync({ postfix: ".mp3" });
    const result = await this.ffmpegService.ConvertVideoToMp3(inputPath, outputFilePath);
    return result;
  }

  private async formatFinalResult(mcpResult: string | undefined): Promise<string | undefined> {
    if (!mcpResult) return undefined;

    try {
      const languageModelProvider = await LanguageModelProvider.getInstance();
      const prompt = `Given the following task execution result, format it as a structured JSON final output:\n\n${mcpResult}`;
      return await languageModelProvider.generateJson(prompt, TASK_EXECUTION_PROMPT);
    } catch (error) {
      console.warn(
        "[ProcessVideo] Failed to format final result, falling back to raw output",
        error,
      );
      return mcpResult;
    }
  }

  private formatProjectDetails(
    projectDetails: (ProjectDto & { selectionReason: string }) | undefined | null,
  ): {
    desktopAgentProjectPrompt: string | undefined;
    projectMetaData: string | undefined;
  } {
    if (!projectDetails) {
      return { desktopAgentProjectPrompt: undefined, projectMetaData: undefined };
    }

    const { desktopAgentProjectPrompt, ...metaData } = projectDetails;
    return {
      desktopAgentProjectPrompt,
      projectMetaData: JSON.stringify(metaData),
    };
  }

  // TODO: Separate the Undo feature and Final Result Panel event triggers from this, and remove this event sender
  // ISSUE: https://github.com/SSWConsulting/SSW.YakShaver.Desktop/issues/602
  private emitProgress(stage: string, data?: Record<string, unknown>, shaveId?: string) {
    BrowserWindow.getAllWindows()
      .filter((win) => !win.isDestroyed())
      .forEach((win) => {
        win.webContents.send(IPC_CHANNELS.WORKFLOW_PROGRESS, {
          stage,
          shaveId,
          ...data,
        });
      });
  }

  // ==================== WORKFLOW RETRY METHODS ====================

  private getOrCreateWorkflowManager(shaveId: string): WorkflowStateManager {
    let manager = this.workflowManagers.get(shaveId);
    if (!manager) {
      manager = new WorkflowStateManager(shaveId);
      this.workflowManagers.set(shaveId, manager);
    }
    return manager;
  }

  private trackTempFile(filePath: string): void {
    if (!this.tempFilesToCleanup.includes(filePath)) {
      this.tempFilesToCleanup.push(filePath);
    }
  }

  private cleanupTempFiles(): void {
    for (const filePath of this.tempFilesToCleanup) {
      try {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      } catch (error) {
        console.warn(`[ProcessVideo] Failed to cleanup temp file: ${filePath}`, error);
      }
    }
    this.tempFilesToCleanup = [];
  }

  private async retryFromStage(stage: keyof WorkflowState, shaveId?: string): Promise<RetryResult> {
    if (!shaveId) {
      return { success: false, error: "Shave ID is required for retry" };
    }

    const workflowManager = this.getOrCreateWorkflowManager(shaveId);

    // Check if retry is allowed
    if (!workflowManager.canRetry(stage)) {
      const retryCount = workflowManager.getRetryCount(stage);
      return {
        success: false,
        error: `Maximum retry attempts (${retryCount}/3) reached for stage ${stage}. Please start a new recording.`,
      };
    }

    // Prepare stage for retry (reset status and subsequent stages)
    const canProceed = workflowManager.prepareStageForRetry(stage);
    if (!canProceed) {
      return {
        success: false,
        error: `Cannot retry stage ${stage}. It may not be in a failed state or max retries reached.`,
      };
    }

    // Get checkpoint data for the stage
    const checkpoint = workflowManager.getCheckpoint(stage);

    // Route to appropriate retry handler
    switch (stage) {
      case "uploading_video":
        return await this.retryUploadingVideo(workflowManager, checkpoint, shaveId);
      case "downloading_video":
        return await this.retryDownloadingVideo(workflowManager, checkpoint, shaveId);
      case "converting_audio":
        return await this.retryConvertingAudio(workflowManager, checkpoint, shaveId);
      case "transcribing":
        return await this.retryTranscribing(workflowManager, checkpoint, shaveId);
      case "analyzing_transcript":
        return await this.retryAnalyzingTranscript(workflowManager, checkpoint, shaveId);
      case "selecting_prompt":
        return await this.retrySelectingPrompt(workflowManager, checkpoint, shaveId);
      case "executing_task":
        return await this.retryExecutingTask(workflowManager, checkpoint, shaveId);
      case "updating_metadata":
        return await this.retryUpdatingMetadata(workflowManager, checkpoint, shaveId);
      default:
        return { success: false, error: `Unknown stage: ${stage}` };
    }
  }

  private async retryUploadingVideo(
    workflowManager: WorkflowStateManager,
    checkpoint: CheckpointData | undefined,
    shaveId?: string,
  ): Promise<RetryResult> {
    const notify = (stage: string, data?: Record<string, unknown>) => {
      this.emitProgress(stage, data, shaveId);
    };

    try {
      workflowManager.startStage(WorkflowProgressStage.UPLOADING_VIDEO);

      // Get file path from checkpoint or last known path
      const filePath = checkpoint?.filePath || this.lastVideoFilePath;

      if (!filePath || !fs.existsSync(filePath)) {
        throw new Error("Original video file not found. Cannot retry upload.");
      }

      // Get duration if available
      let duration: number | undefined;
      if (shaveId) {
        const shaveService = ShaveService.getInstance();
        const videoSource = shaveService.getShaveVideoSourceInfo(shaveId);
        duration = videoSource?.durationSeconds ?? undefined;
      }

      notify(ProgressStage.UPLOADING_SOURCE, { sourceOrigin: "upload" });

      const youtubeResult = await this.youtube.uploadVideo(filePath);

      if (youtubeResult.success && youtubeResult.data && duration) {
        youtubeResult.data.duration = duration;
      }

      workflowManager.completeStage(WorkflowProgressStage.UPLOADING_VIDEO, youtubeResult.data?.url);
      notify(ProgressStage.UPLOAD_COMPLETED, {
        uploadResult: youtubeResult,
        sourceOrigin: youtubeResult.origin,
      });

      // Create checkpoint and continue processing
      workflowManager.createCheckpoint(WorkflowProgressStage.UPLOADING_VIDEO, {
        filePath,
        youtubeResult,
      });

      // Continue to next stage
      return await this.processVideoSource({ filePath, youtubeResult, shaveId }, workflowManager);
    } catch (error) {
      const errorMessage = formatAndReportError(error, "retry_upload");
      workflowManager.failStage(WorkflowProgressStage.UPLOADING_VIDEO, errorMessage);
      return { success: false, error: errorMessage };
    }
  }

  private async retryDownloadingVideo(
    workflowManager: WorkflowStateManager,
    checkpoint: CheckpointData | undefined,
    shaveId?: string,
  ): Promise<RetryResult> {
    const notify = (stage: string, data?: Record<string, unknown>) => {
      this.emitProgress(stage, data, shaveId);
    };

    try {
      workflowManager.startStage(WorkflowProgressStage.DOWNLOADING_VIDEO);

      const downloadUrl = checkpoint?.downloadUrl;
      if (!downloadUrl) {
        throw new Error("Original download URL not found. Cannot retry download.");
      }

      const youtubeResult = await this.youtubeDownloadService.getVideoMetadata(downloadUrl);
      notify(ProgressStage.UPLOAD_COMPLETED, {
        uploadResult: youtubeResult,
        sourceOrigin: "external",
      });
      notify(ProgressStage.DOWNLOADING_SOURCE, { sourceOrigin: "external" });

      const filePath = await this.youtubeDownloadService.downloadVideoToFile(downloadUrl);

      workflowManager.completeStage(WorkflowProgressStage.DOWNLOADING_VIDEO);

      // Create checkpoint and continue
      workflowManager.createCheckpoint(WorkflowProgressStage.DOWNLOADING_VIDEO, {
        filePath,
        youtubeResult,
        downloadUrl,
      });

      return await this.processVideoSource({ filePath, youtubeResult, shaveId }, workflowManager);
    } catch (error) {
      const errorMessage = formatAndReportError(error, "retry_download");
      workflowManager.failStage(WorkflowProgressStage.DOWNLOADING_VIDEO, errorMessage);
      notify(ProgressStage.ERROR, { error: errorMessage });
      return { success: false, error: errorMessage };
    }
  }

  private async retryConvertingAudio(
    workflowManager: WorkflowStateManager,
    checkpoint: CheckpointData | undefined,
    shaveId?: string,
  ): Promise<RetryResult> {
    const notify = (stage: string, data?: Record<string, unknown>) => {
      this.emitProgress(stage, data, shaveId);
    };

    try {
      const filePath = checkpoint?.filePath || this.lastVideoFilePath;

      if (!filePath || !fs.existsSync(filePath)) {
        throw new Error("Video file not found. Cannot retry audio conversion.");
      }

      workflowManager.startStage(WorkflowProgressStage.CONVERTING_AUDIO);
      notify(ProgressStage.CONVERTING_AUDIO);

      const hasAudio = await this.ffmpegService.hasAudibleAudio(filePath);
      if (!hasAudio) {
        const errorMessage =
          "No audio detected in this video. Please re-record and make sure the correct microphone is selected and unmuted.";
        workflowManager.failStage(WorkflowProgressStage.CONVERTING_AUDIO, errorMessage);
        notify(ProgressStage.ERROR, { error: errorMessage });
        return { success: false, error: errorMessage };
      }

      const mp3FilePath = await this.convertVideoToMp3(filePath);
      this.trackTempFile(mp3FilePath);

      workflowManager.completeStage(WorkflowProgressStage.CONVERTING_AUDIO);

      // Create checkpoint and continue
      workflowManager.createCheckpoint(WorkflowProgressStage.CONVERTING_AUDIO, {
        filePath,
        mp3FilePath,
        hasAudio,
      });

      // Get the existing checkpoint data from previous stages
      const existingYoutubeResult = checkpoint?.youtubeResult;
      if (!existingYoutubeResult) {
        throw new Error("Previous stage checkpoint data not found.");
      }

      // Continue to transcribing with the new MP3 file
      return await this.retryTranscribingFromMp3(
        workflowManager,
        { filePath, mp3FilePath, youtubeResult: existingYoutubeResult },
        shaveId,
      );
    } catch (error) {
      const errorMessage = formatAndReportError(error, "retry_converting_audio");
      workflowManager.failStage(WorkflowProgressStage.CONVERTING_AUDIO, errorMessage);
      notify(ProgressStage.ERROR, { error: errorMessage });
      return { success: false, error: errorMessage };
    }
  }

  private async retryTranscribingFromMp3(
    workflowManager: WorkflowStateManager,
    context: { filePath: string; mp3FilePath: string; youtubeResult: VideoUploadResult },
    shaveId?: string,
  ): Promise<RetryResult> {
    const notify = (stage: string, data?: Record<string, unknown>) => {
      this.emitProgress(stage, data, shaveId);
    };

    try {
      workflowManager.startStage(WorkflowProgressStage.TRANSCRIBING);
      notify(ProgressStage.TRANSCRIBING);

      const transcriptionModelProvider = await TranscriptionModelProvider.getInstance();
      const transcript = await transcriptionModelProvider.transcribeAudio(context.mp3FilePath);
      const transcriptText = transcript.map((seg) => seg.text).join("");

      if (!transcriptText.trim()) {
        const errorMessage =
          "No speech detected in this recording. Please re-record and check your microphone and audio levels.";
        workflowManager.failStage(WorkflowProgressStage.TRANSCRIBING, errorMessage);
        notify(ProgressStage.ERROR, { error: errorMessage });
        return { success: false, error: errorMessage };
      }

      notify(ProgressStage.TRANSCRIPTION_COMPLETED, { transcript });
      workflowManager.completeStage(WorkflowProgressStage.TRANSCRIBING, transcriptText);

      // Create checkpoint and continue
      workflowManager.createCheckpoint(WorkflowProgressStage.TRANSCRIBING, {
        filePath: context.filePath,
        transcript,
        transcriptText,
        mp3FilePath: context.mp3FilePath,
        youtubeResult: context.youtubeResult,
      });

      // Continue to analyzing
      return await this.retryAnalyzingTranscriptFromTranscript(
        workflowManager,
        { ...context, transcript, transcriptText },
        shaveId,
      );
    } catch (error) {
      const errorMessage = formatAndReportError(error, "retry_transcribing");
      workflowManager.failStage(WorkflowProgressStage.TRANSCRIBING, errorMessage);
      notify(ProgressStage.ERROR, { error: errorMessage });
      return { success: false, error: errorMessage };
    }
  }

  private async retryTranscribing(
    workflowManager: WorkflowStateManager,
    checkpoint: CheckpointData | undefined,
    shaveId?: string,
  ): Promise<RetryResult> {
    const notify = (stage: string, data?: Record<string, unknown>) => {
      this.emitProgress(stage, data, shaveId);
    };

    try {
      const mp3FilePath = checkpoint?.mp3FilePath;
      const filePath = checkpoint?.filePath;
      const youtubeResult = checkpoint?.youtubeResult;

      if (!mp3FilePath || !fs.existsSync(mp3FilePath)) {
        throw new Error("Audio file not found. Cannot retry transcription.");
      }

      if (!filePath || !youtubeResult) {
        throw new Error("Previous stage checkpoint data not found.");
      }

      workflowManager.startStage(WorkflowProgressStage.TRANSCRIBING);
      notify(ProgressStage.TRANSCRIBING);

      const transcriptionModelProvider = await TranscriptionModelProvider.getInstance();
      const transcript = await transcriptionModelProvider.transcribeAudio(mp3FilePath);
      const transcriptText = transcript.map((seg) => seg.text).join("");

      if (!transcriptText.trim()) {
        const errorMessage =
          "No speech detected in this recording. Please re-record and check your microphone and audio levels.";
        workflowManager.failStage(WorkflowProgressStage.TRANSCRIBING, errorMessage);
        notify(ProgressStage.ERROR, { error: errorMessage });
        return { success: false, error: errorMessage };
      }

      notify(ProgressStage.TRANSCRIPTION_COMPLETED, { transcript });
      workflowManager.completeStage(WorkflowProgressStage.TRANSCRIBING, transcriptText);

      // Create checkpoint and continue
      workflowManager.createCheckpoint(WorkflowProgressStage.TRANSCRIBING, {
        filePath,
        transcript,
        transcriptText,
        mp3FilePath,
        youtubeResult,
      });

      return await this.retryAnalyzingTranscriptFromTranscript(
        workflowManager,
        { filePath, youtubeResult, transcript, transcriptText, mp3FilePath },
        shaveId,
      );
    } catch (error) {
      const errorMessage = formatAndReportError(error, "retry_transcribing");
      workflowManager.failStage(WorkflowProgressStage.TRANSCRIBING, errorMessage);
      notify(ProgressStage.ERROR, { error: errorMessage });
      return { success: false, error: errorMessage };
    }
  }

  private async retryAnalyzingTranscriptFromTranscript(
    workflowManager: WorkflowStateManager,
    context: {
      filePath: string;
      youtubeResult: VideoUploadResult;
      transcript: TranscriptSegment[];
      transcriptText: string;
      mp3FilePath: string;
    },
    shaveId?: string,
  ): Promise<RetryResult> {
    const notify = (stage: string, data?: Record<string, unknown>) => {
      this.emitProgress(stage, data, shaveId);
    };

    try {
      workflowManager.startStage(WorkflowProgressStage.ANALYZING_TRANSCRIPT);
      notify(ProgressStage.GENERATING_TASK);

      const languageModelProvider = await LanguageModelProvider.getInstance();

      const userPrompt = `Process the following transcript into a structured JSON object:

      ${context.transcriptText}`;

      const intermediateOutput = await languageModelProvider.generateJson(
        userPrompt,
        INITIAL_SUMMARY_PROMPT,
      );

      workflowManager.completeStage(WorkflowProgressStage.ANALYZING_TRANSCRIPT, intermediateOutput);

      // Create checkpoint and continue
      workflowManager.createCheckpoint(WorkflowProgressStage.ANALYZING_TRANSCRIPT, {
        filePath: context.filePath,
        youtubeResult: context.youtubeResult,
        transcript: context.transcript,
        transcriptText: context.transcriptText,
        mp3FilePath: context.mp3FilePath,
        intermediateOutput,
      });

      return await this.retrySelectingPromptFromIntermediate(
        workflowManager,
        { ...context, intermediateOutput },
        shaveId,
      );
    } catch (error) {
      const errorMessage = formatAndReportError(error, "retry_analyzing_transcript");
      workflowManager.failStage(WorkflowProgressStage.ANALYZING_TRANSCRIPT, errorMessage);
      notify(ProgressStage.ERROR, { error: errorMessage });
      return { success: false, error: errorMessage };
    }
  }

  private async retryAnalyzingTranscript(
    workflowManager: WorkflowStateManager,
    checkpoint: CheckpointData | undefined,
    shaveId?: string,
  ): Promise<RetryResult> {
    const notify = (stage: string, data?: Record<string, unknown>) => {
      this.emitProgress(stage, data, shaveId);
    };

    try {
      const transcriptText = checkpoint?.transcriptText;
      const filePath = checkpoint?.filePath;
      const youtubeResult = checkpoint?.youtubeResult;
      const transcript = checkpoint?.transcript;
      const mp3FilePath = checkpoint?.mp3FilePath;

      if (!transcriptText) {
        throw new Error("Transcript not found in checkpoint. Cannot retry analysis.");
      }

      if (!filePath || !youtubeResult) {
        throw new Error("Previous stage checkpoint data not found.");
      }

      workflowManager.startStage(WorkflowProgressStage.ANALYZING_TRANSCRIPT);
      notify(ProgressStage.GENERATING_TASK);

      const languageModelProvider = await LanguageModelProvider.getInstance();

      const userPrompt = `Process the following transcript into a structured JSON object:

      ${transcriptText}`;

      const intermediateOutput = await languageModelProvider.generateJson(
        userPrompt,
        INITIAL_SUMMARY_PROMPT,
      );

      workflowManager.completeStage(WorkflowProgressStage.ANALYZING_TRANSCRIPT, intermediateOutput);

      // Create checkpoint and continue
      workflowManager.createCheckpoint(WorkflowProgressStage.ANALYZING_TRANSCRIPT, {
        filePath,
        youtubeResult,
        transcript,
        transcriptText: transcriptText!,
        mp3FilePath: mp3FilePath!,
        intermediateOutput,
      });

      return await this.retrySelectingPromptFromIntermediate(
        workflowManager,
        {
          filePath,
          youtubeResult,
          transcript,
          transcriptText: transcriptText!,
          mp3FilePath: mp3FilePath!,
          intermediateOutput,
        },
        shaveId,
      );
    } catch (error) {
      const errorMessage = formatAndReportError(error, "retry_analyzing_transcript");
      workflowManager.failStage(WorkflowProgressStage.ANALYZING_TRANSCRIPT, errorMessage);
      notify(ProgressStage.ERROR, { error: errorMessage });
      return { success: false, error: errorMessage };
    }
  }

  private async retrySelectingPromptFromIntermediate(
    workflowManager: WorkflowStateManager,
    context: {
      filePath: string;
      youtubeResult: VideoUploadResult;
      transcript?: TranscriptSegment[];
      transcriptText: string;
      mp3FilePath: string;
      intermediateOutput: string;
    },
    shaveId?: string,
  ): Promise<RetryResult> {
    const notify = (stage: string, data?: Record<string, unknown>) => {
      this.emitProgress(stage, data, shaveId);
    };

    try {
      workflowManager.startStage(WorkflowProgressStage.SELECTING_PROMPT);

      const languageModelProvider = await LanguageModelProvider.getInstance();
      const projectDetails = await PromptSelectionService.getInstance().getConfirmedProjectDetails(
        languageModelProvider,
        context.transcriptText,
      );

      const { desktopAgentProjectPrompt, projectMetaData } =
        this.formatProjectDetails(projectDetails);

      workflowManager.completeStage(WorkflowProgressStage.SELECTING_PROMPT, projectDetails);

      // Create checkpoint and continue
      workflowManager.createCheckpoint(WorkflowProgressStage.SELECTING_PROMPT, {
        filePath: context.filePath,
        youtubeResult: context.youtubeResult,
        transcript: context.transcript,
        transcriptText: context.transcriptText,
        mp3FilePath: context.mp3FilePath,
        intermediateOutput: context.intermediateOutput,
        projectDetails: projectDetails
          ? {
              name: projectDetails.name,
              description: projectDetails.description,
              desktopAgentProjectPrompt: projectDetails.desktopAgentProjectPrompt,
              selectionReason: projectDetails.selectionReason,
              selectedMcpServerIds: projectDetails.selectedMcpServerIds,
            }
          : undefined,
        projectMetaData,
        desktopAgentProjectPrompt,
      });

      return await this.retryExecutingTaskFromSelection(
        workflowManager,
        { ...context, projectDetails, projectMetaData, desktopAgentProjectPrompt },
        shaveId,
      );
    } catch (error) {
      const errorMessage = formatAndReportError(error, "retry_selecting_prompt");
      workflowManager.failStage(WorkflowProgressStage.SELECTING_PROMPT, errorMessage);
      notify(ProgressStage.ERROR, { error: errorMessage });
      return { success: false, error: errorMessage };
    }
  }

  private async retrySelectingPrompt(
    workflowManager: WorkflowStateManager,
    checkpoint: CheckpointData | undefined,
    shaveId?: string,
  ): Promise<RetryResult> {
    const notify = (stage: string, data?: Record<string, unknown>) => {
      this.emitProgress(stage, data, shaveId);
    };

    try {
      const transcriptText = checkpoint?.transcriptText;
      const intermediateOutput = checkpoint?.intermediateOutput;
      const filePath = checkpoint?.filePath;
      const youtubeResult = checkpoint?.youtubeResult;
      const transcript = checkpoint?.transcript;
      const mp3FilePath = checkpoint?.mp3FilePath;

      if (!transcriptText) {
        throw new Error("Transcript not found in checkpoint. Cannot retry project selection.");
      }

      if (!intermediateOutput || !filePath || !youtubeResult) {
        throw new Error("Previous stage checkpoint data not found.");
      }

      workflowManager.startStage(WorkflowProgressStage.SELECTING_PROMPT);

      const languageModelProvider = await LanguageModelProvider.getInstance();
      const projectDetails = await PromptSelectionService.getInstance().getConfirmedProjectDetails(
        languageModelProvider,
        transcriptText,
      );

      const { desktopAgentProjectPrompt, projectMetaData } =
        this.formatProjectDetails(projectDetails);

      workflowManager.completeStage(WorkflowProgressStage.SELECTING_PROMPT, projectDetails);

      // Create checkpoint and continue
      workflowManager.createCheckpoint(WorkflowProgressStage.SELECTING_PROMPT, {
        filePath,
        youtubeResult,
        transcript,
        transcriptText: transcriptText!,
        mp3FilePath: mp3FilePath!,
        intermediateOutput: intermediateOutput!,
        projectDetails: projectDetails
          ? {
              name: projectDetails.name,
              description: projectDetails.description,
              desktopAgentProjectPrompt: projectDetails.desktopAgentProjectPrompt,
              selectionReason: projectDetails.selectionReason,
              selectedMcpServerIds: projectDetails.selectedMcpServerIds,
            }
          : undefined,
        projectMetaData,
        desktopAgentProjectPrompt,
      });

      return await this.retryExecutingTaskFromSelection(
        workflowManager,
        {
          filePath,
          youtubeResult,
          transcript,
          transcriptText: transcriptText!,
          mp3FilePath: mp3FilePath!,
          intermediateOutput: intermediateOutput!,
          projectDetails,
          projectMetaData,
          desktopAgentProjectPrompt,
        },
        shaveId,
      );
    } catch (error) {
      const errorMessage = formatAndReportError(error, "retry_selecting_prompt");
      workflowManager.failStage(WorkflowProgressStage.SELECTING_PROMPT, errorMessage);
      notify(ProgressStage.ERROR, { error: errorMessage });
      return { success: false, error: errorMessage };
    }
  }

  private async retryExecutingTaskFromSelection(
    workflowManager: WorkflowStateManager,
    context: {
      filePath: string;
      youtubeResult: VideoUploadResult;
      transcript?: TranscriptSegment[];
      transcriptText: string;
      mp3FilePath: string;
      intermediateOutput: string;
      projectDetails?: (ProjectDto & { selectionReason: string }) | undefined | null;
      projectMetaData?: string;
      desktopAgentProjectPrompt?: string;
    },
    shaveId?: string,
  ): Promise<RetryResult> {
    const notify = (stage: string, data?: Record<string, unknown>) => {
      this.emitProgress(stage, data, shaveId);
    };

    try {
      workflowManager.startStage(WorkflowProgressStage.EXECUTING_TASK);
      notify(ProgressStage.EXECUTING_TASK, {
        transcriptText: context.transcriptText,
        intermediateOutput: context.intermediateOutput,
      });

      const serverFilter = context.projectDetails?.selectedMcpServerIds;

      const mcpAdapter = new McpWorkflowAdapter(workflowManager, {
        transcriptText: context.transcriptText,
        intermediateOutput: context.intermediateOutput,
      });

      const orchestrator = await MCPOrchestrator.getInstanceAsync();
      const mcpResult = await orchestrator.manualLoopAsync(
        context.transcriptText,
        context.youtubeResult,
        {
          projectMetaData: context.projectMetaData,
          desktopAgentProjectPrompt: context.desktopAgentProjectPrompt,
          videoFilePath: context.filePath,
          serverFilter,
          onStep: mcpAdapter.onStep,
        },
      );

      const finalOutput = await this.formatFinalResult(mcpResult);
      mcpAdapter.complete(mcpResult);

      // Create checkpoint
      workflowManager.createCheckpoint(WorkflowProgressStage.EXECUTING_TASK, {
        filePath: context.filePath,
        youtubeResult: context.youtubeResult,
        transcript: context.transcript,
        transcriptText: context.transcriptText,
        mp3FilePath: context.mp3FilePath,
        intermediateOutput: context.intermediateOutput,
        projectDetails: context.projectDetails || undefined,
        projectMetaData: context.projectMetaData,
        desktopAgentProjectPrompt: context.desktopAgentProjectPrompt,
        mcpSteps: [], // Would need to capture from adapter
        mcpResult,
        finalOutput,
      });

      // Send to portal if authenticated
      if (mcpResult && (await MicrosoftAuthService.getInstance().isAuthenticated())) {
        try {
          const objectResult = await orchestrator.convertToObjectAsync(
            mcpResult,
            WorkItemDtoSchema,
          );
          const portalResult = await SendWorkItemDetailsToPortal(
            WorkItemDtoSchema.parse(objectResult),
          );
          if (!portalResult.success) {
            console.warn("[ProcessVideo] Portal submission failed:", portalResult.error);
          } else if (shaveId) {
            const shaveService = ShaveService.getInstance();
            shaveService.updateShave(shaveId, { portalWorkItemId: portalResult.workItemId });
          }
        } catch (portalError) {
          console.warn("[ProcessVideo] Failed to send to portal:", portalError);
        }
      }

      // Continue to metadata update
      return await this.retryUpdatingMetadataFromResult(
        workflowManager,
        { ...context, mcpResult, finalOutput, projectDetails: context.projectDetails || undefined },
        shaveId,
      );
    } catch (error) {
      const errorMessage = formatAndReportError(error, "retry_executing_task");
      workflowManager.failStage(WorkflowProgressStage.EXECUTING_TASK, errorMessage);
      notify(ProgressStage.ERROR, { error: errorMessage });
      return { success: false, error: errorMessage };
    }
  }

  private async retryExecutingTask(
    workflowManager: WorkflowStateManager,
    checkpoint: CheckpointData | undefined,
    shaveId?: string,
  ): Promise<RetryResult> {
    const notify = (stage: string, data?: Record<string, unknown>) => {
      this.emitProgress(stage, data, shaveId);
    };

    try {
      const intermediateOutput = checkpoint?.intermediateOutput;
      const youtubeResult = checkpoint?.youtubeResult;
      const filePath = checkpoint?.filePath;
      const transcriptText = checkpoint?.transcriptText;
      const transcript = checkpoint?.transcript;
      const mp3FilePath = checkpoint?.mp3FilePath;
      const projectDetails = checkpoint?.projectDetails;
      const projectMetaData = checkpoint?.projectMetaData;
      const desktopAgentProjectPrompt = checkpoint?.desktopAgentProjectPrompt;

      if (!intermediateOutput || !youtubeResult) {
        throw new Error("Required checkpoint data not found. Cannot retry task execution.");
      }

      workflowManager.startStage(WorkflowProgressStage.EXECUTING_TASK);
      notify(ProgressStage.EXECUTING_TASK, { transcriptText, intermediateOutput });

      const serverFilter = projectDetails?.selectedMcpServerIds;

      const mcpAdapter = new McpWorkflowAdapter(workflowManager, {
        transcriptText,
        intermediateOutput,
      });

      const orchestrator = await MCPOrchestrator.getInstanceAsync();
      const mcpResult = await orchestrator.manualLoopAsync(
        transcriptText || intermediateOutput,
        youtubeResult,
        {
          projectMetaData,
          desktopAgentProjectPrompt,
          videoFilePath: filePath,
          serverFilter,
          onStep: mcpAdapter.onStep,
        },
      );

      const finalOutput = await this.formatFinalResult(mcpResult);
      mcpAdapter.complete(mcpResult);

      // Create checkpoint
      workflowManager.createCheckpoint(WorkflowProgressStage.EXECUTING_TASK, {
        filePath: filePath!,
        youtubeResult,
        transcript,
        transcriptText: transcriptText!,
        mp3FilePath: mp3FilePath!,
        intermediateOutput,
        projectDetails: projectDetails || undefined,
        projectMetaData,
        desktopAgentProjectPrompt,
        mcpSteps: [],
        mcpResult,
      });

      // Send to portal if authenticated
      if (mcpResult && (await MicrosoftAuthService.getInstance().isAuthenticated())) {
        try {
          const objectResult = await orchestrator.convertToObjectAsync(
            mcpResult,
            WorkItemDtoSchema,
          );
          const portalResult = await SendWorkItemDetailsToPortal(
            WorkItemDtoSchema.parse(objectResult),
          );
          if (!portalResult.success) {
            console.warn("[ProcessVideo] Portal submission failed:", portalResult.error);
          } else if (shaveId) {
            const shaveService = ShaveService.getInstance();
            shaveService.updateShave(shaveId, { portalWorkItemId: portalResult.workItemId });
          }
        } catch (portalError) {
          console.warn("[ProcessVideo] Failed to send to portal:", portalError);
        }
      }

      return await this.retryUpdatingMetadataFromResult(
        workflowManager,
        {
          filePath: filePath!,
          youtubeResult,
          transcript,
          transcriptText: transcriptText!,
          mp3FilePath: mp3FilePath!,
          intermediateOutput,
          projectDetails,
          projectMetaData,
          desktopAgentProjectPrompt,
          mcpResult,
          finalOutput,
        },
        shaveId,
      );
    } catch (error) {
      const errorMessage = formatAndReportError(error, "retry_executing_task");
      workflowManager.failStage(WorkflowProgressStage.EXECUTING_TASK, errorMessage);
      notify(ProgressStage.ERROR, { error: errorMessage });
      return { success: false, error: errorMessage };
    }
  }

  private async retryUpdatingMetadataFromResult(
    workflowManager: WorkflowStateManager,
    context: {
      filePath: string;
      youtubeResult: VideoUploadResult;
      transcript?: TranscriptSegment[];
      transcriptText?: string;
      mp3FilePath?: string;
      intermediateOutput?: string;
      projectDetails?: {
        name?: string;
        description?: string;
        desktopAgentProjectPrompt?: string;
        selectionReason?: string;
        selectedMcpServerIds?: string[];
      };
      projectMetaData?: string;
      desktopAgentProjectPrompt?: string;
      mcpResult?: string;
      finalOutput?: string;
      metadataUpdateError?: string;
    },
    shaveId?: string,
  ): Promise<RetryResult> {
    const notify = (stage: string, data?: Record<string, unknown>) => {
      this.emitProgress(stage, data, shaveId);
    };

    try {
      // Only update metadata for uploaded videos (not external URLs)
      if (context.youtubeResult.origin === "external" || !context.youtubeResult.success) {
        notify(ProgressStage.COMPLETED, {
          transcript: context.transcript,
          mcpResult: context.mcpResult,
          finalOutput: context.finalOutput,
          uploadResult: context.youtubeResult,
        });
        this.cleanupTempFiles();
        return {
          success: true,
          youtubeResult: context.youtubeResult,
          mcpResult: context.mcpResult,
        };
      }

      const videoId = context.youtubeResult.data?.videoId;
      if (!videoId) {
        throw new Error("Video ID not found. Cannot update metadata.");
      }

      workflowManager.startStage(WorkflowProgressStage.UPDATING_METADATA);
      notify(ProgressStage.UPDATING_METADATA);
      workflowManager.updateStagePayload(
        WorkflowProgressStage.UPDATING_METADATA,
        null,
        "in_progress",
      );

      const metadata = await this.metadataBuilder.build({
        transcript: context.transcript!,
        intermediateOutput: "",
        executionHistory: JSON.stringify(context.transcript ?? [], null, 2),
        finalResult: context.mcpResult ?? undefined,
      });

      notify(ProgressStage.UPDATING_METADATA, {
        metadataPreview: metadata.metadata,
      });

      const updateResult = await this.youtube.updateVideoMetadata(
        videoId,
        metadata.snippet,
        context.youtubeResult.origin,
      );

      if (updateResult.success) {
        workflowManager.completeStage(WorkflowProgressStage.UPDATING_METADATA, metadata.metadata);
      } else {
        throw new Error(
          `[ProcessVideo] YouTube metadata update failed: ${updateResult.error || "Unknown error"}`,
        );
      }

      notify(ProgressStage.COMPLETED, {
        transcript: context.transcript,
        mcpResult: context.mcpResult,
        finalOutput: context.finalOutput,
        uploadResult: context.youtubeResult,
      });

      this.cleanupTempFiles();
      return { success: true, youtubeResult: context.youtubeResult, mcpResult: context.mcpResult };
    } catch (error) {
      console.warn("Metadata update failed", error);
      const metadataErrorMsg = formatAndReportError(error, "retry_metadata_update");
      workflowManager.failStage(WorkflowProgressStage.UPDATING_METADATA, metadataErrorMsg);

      // Still return success if task execution succeeded, just note the metadata error
      notify(ProgressStage.COMPLETED, {
        transcript: context.transcript,
        mcpResult: context.mcpResult,
        finalOutput: context.finalOutput,
        uploadResult: context.youtubeResult,
        metadataUpdateError: metadataErrorMsg,
      });

      // Don't cleanup temp files if metadata failed - user might want to retry
      return {
        success: true,
        youtubeResult: context.youtubeResult,
        mcpResult: context.mcpResult,
      };
    }
  }

  private async retryUpdatingMetadata(
    workflowManager: WorkflowStateManager,
    checkpoint: CheckpointData | undefined,
    shaveId?: string,
  ): Promise<RetryResult> {
    const notify = (stage: string, data?: Record<string, unknown>) => {
      this.emitProgress(stage, data, shaveId);
    };

    try {
      const youtubeResult = checkpoint?.youtubeResult;
      const transcript = checkpoint?.transcript;
      const mcpResult = checkpoint?.mcpResult;
      const finalOutput = checkpoint?.finalOutput;

      if (!youtubeResult || !youtubeResult.success) {
        throw new Error("YouTube upload result not found. Cannot update metadata.");
      }

      // Only for uploaded videos (not external URLs)
      if (youtubeResult.origin === "external") {
        return { success: true };
      }

      const videoId = youtubeResult.data?.videoId;
      if (!videoId) {
        throw new Error("Video ID not found. Cannot update metadata.");
      }

      workflowManager.startStage(WorkflowProgressStage.UPDATING_METADATA);
      notify(ProgressStage.UPDATING_METADATA);
      workflowManager.updateStagePayload(
        WorkflowProgressStage.UPDATING_METADATA,
        null,
        "in_progress",
      );

      const metadata = await this.metadataBuilder.build({
        transcript: transcript!,
        intermediateOutput: "",
        executionHistory: JSON.stringify(transcript ?? [], null, 2),
        finalResult: mcpResult ?? undefined,
      });

      notify(ProgressStage.UPDATING_METADATA, {
        metadataPreview: metadata.metadata,
      });

      const updateResult = await this.youtube.updateVideoMetadata(
        videoId,
        metadata.snippet,
        youtubeResult.origin,
      );

      if (updateResult.success) {
        workflowManager.completeStage(WorkflowProgressStage.UPDATING_METADATA, metadata.metadata);
        notify(ProgressStage.COMPLETED, {
          transcript,
          mcpResult,
          finalOutput,
          uploadResult: youtubeResult,
        });
        this.cleanupTempFiles();
        return { success: true };
      } else {
        throw new Error(
          `[ProcessVideo] YouTube metadata update failed: ${updateResult.error || "Unknown error"}`,
        );
      }
    } catch (error) {
      console.warn("Metadata update retry failed", error);
      const metadataErrorMsg = formatAndReportError(error, "retry_metadata_update");
      workflowManager.failStage(WorkflowProgressStage.UPDATING_METADATA, metadataErrorMsg);
      return { success: false, error: metadataErrorMsg };
    }
  }
}
