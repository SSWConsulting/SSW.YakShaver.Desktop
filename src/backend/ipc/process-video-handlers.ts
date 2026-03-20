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
import { FaultInjection } from "../services/workflow/fault-injection";
import { McpWorkflowAdapter } from "../services/workflow/mcp-workflow-adapter";
import { PromptSelectionService } from "../services/workflow/prompt-selection-service";
import type { CheckpointData } from "../services/workflow/workflow-checkpoint-service";
import {
  type RetryResult,
  resolveCheckpointData,
  type VideoProcessingContext,
  WorkflowRetryService,
} from "../services/workflow/workflow-retry-service";
import { WorkflowStateManager } from "../services/workflow/workflow-state-manager";
import { ProgressStage } from "../types";
import { formatAndReportError } from "../utils/error-utils";
import { IPC_CHANNELS } from "./channels";

export type { VideoProcessingContext, RetryResult };

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
  private readonly retryService: WorkflowRetryService;

  constructor() {
    this.metadataBuilder = new VideoMetadataBuilder();
    this.retryService = new WorkflowRetryService({
      youtube: this.youtube,
      youtubeDownloadService: this.youtubeDownloadService,
      processVideoSource: this.processVideoSource.bind(this),
      emitProgress: this.emitProgress.bind(this),
      trackTempFile: this.trackTempFile.bind(this),
      getLastVideoFilePath: () => this.lastVideoFilePath,
      getOrCreateWorkflowManager: this.getOrCreateWorkflowManager.bind(this),
    });
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

    // Re-execute: user-initiated re-run from SELECTING_PROMPT with modified input after a successful workflow.
    // Different from WORKFLOW_RETRY_FROM_STAGE which resumes from a failed checkpoint.
    ipcMain.handle(
      IPC_CHANNELS.RERUN_TASK,
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
          const errorMessage = formatAndReportError(error, "rerun_task");
          notify(ProgressStage.ERROR, { error: errorMessage });
          return { success: false, error: errorMessage };
        }
      },
    );

    // Resume from failure: restores checkpoint data and re-runs from the failed stage onward.
    // Different from RERUN_TASK which is a user-initiated re-execution after success.
    ipcMain.handle(
      IPC_CHANNELS.WORKFLOW_RETRY_FROM_STAGE,
      async (_event: IpcMainInvokeEvent, stage: keyof WorkflowState, shaveId?: string) => {
        try {
          return await this.retryService.retryFromStage(stage, shaveId);
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

    // Dev/Testing: Fault injection controls
    ipcMain.handle(
      IPC_CHANNELS.DEV_FAULT_INJECTION_SET,
      (_event, stage: string, failOnRetry?: boolean) => {
        FaultInjection.setFailAtStage(stage as keyof WorkflowState);
        if (failOnRetry !== undefined) {
          FaultInjection.setFailOnRetry(failOnRetry);
        }
        return FaultInjection.getStatus();
      },
    );

    ipcMain.handle(IPC_CHANNELS.DEV_FAULT_INJECTION_CLEAR, () => {
      FaultInjection.clear();
      return FaultInjection.getStatus();
    });

    ipcMain.handle(IPC_CHANNELS.DEV_FAULT_INJECTION_STATUS, () => {
      return FaultInjection.getStatus();
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

    this.lastVideoFilePath = filePath;
    this.trackTempFile(filePath);

    workflowManager.startStage(WorkflowProgressStage.UPLOADING_VIDEO);
    workflowManager.skipStage(WorkflowProgressStage.DOWNLOADING_VIDEO);

    // Save checkpoint before upload so retry can find the file path
    workflowManager.createCheckpoint(WorkflowProgressStage.UPLOADING_VIDEO, {
      filePath,
    });

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
      FaultInjection.checkAndThrow("uploading_video", workflowManager);

      const youtubeResult = await this.youtube.uploadVideo(filePath);

      if (youtubeResult.success && youtubeResult.data && duration) {
        youtubeResult.data.duration = duration;
      }

      workflowManager.completeStage(WorkflowProgressStage.UPLOADING_VIDEO, youtubeResult.data?.url);

      // Update checkpoint with upload result
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

    // Save checkpoint before download so retry can find the URL
    workflowManager.createCheckpoint(WorkflowProgressStage.DOWNLOADING_VIDEO, {
      downloadUrl: url,
    });

    try {
      FaultInjection.checkAndThrow("downloading_video", workflowManager);
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
    startFromStage?: keyof WorkflowState,
  ): Promise<RetryResult> {
    // check file exists
    if (!fs.existsSync(filePath)) {
      throw new Error("video-process-handler: Video file does not exist");
    }

    const notify = (stage: string, data?: Record<string, unknown>) => {
      this.emitProgress(stage, data, shaveId);
    };

    // Stage ordering within this method (upload/download handled by callers)
    const STAGES_IN_ORDER: (keyof WorkflowState)[] = [
      WorkflowProgressStage.CONVERTING_AUDIO,
      WorkflowProgressStage.TRANSCRIBING,
      WorkflowProgressStage.ANALYZING_TRANSCRIPT,
      WorkflowProgressStage.SELECTING_PROMPT,
      WorkflowProgressStage.EXECUTING_TASK,
      WorkflowProgressStage.UPDATING_METADATA,
    ];

    const startIdx = startFromStage ? Math.max(0, STAGES_IN_ORDER.indexOf(startFromStage)) : 0;

    const shouldRunStage = (stage: keyof WorkflowState) =>
      STAGES_IN_ORDER.indexOf(stage) >= startIdx;

    const isRetry = startFromStage !== undefined;

    // Resolve merged checkpoint data for skipped stages' outputs
    const checkpoint: CheckpointData =
      startIdx > 0 && startFromStage ? resolveCheckpointData(workflowManager, startFromStage) : {};

    // Local variables — populated from stage execution or merged checkpoint
    let mp3FilePath: string | undefined = checkpoint.mp3FilePath;
    let transcript: TranscriptSegment[] | undefined = checkpoint.transcript;
    let transcriptText: string | undefined = checkpoint.transcriptText;
    let intermediateOutput: string | undefined = checkpoint.intermediateOutput;
    let projectDetails: (ProjectDto & { selectionReason: string }) | undefined | null =
      checkpoint.projectDetails as (ProjectDto & { selectionReason: string }) | undefined;
    let projectMetaData: string | undefined = checkpoint.projectMetaData;
    let desktopAgentProjectPrompt: string | undefined = checkpoint.desktopAgentProjectPrompt;
    let mcpResult: string | undefined = checkpoint.mcpResult;
    let finalOutput: string | undefined = checkpoint.finalOutput;

    let currentStage: keyof WorkflowState | null = null;

    try {
      this.lastVideoFilePath = filePath;

      // -- CONVERTING_AUDIO --
      if (shouldRunStage(WorkflowProgressStage.CONVERTING_AUDIO)) {
        currentStage = WorkflowProgressStage.CONVERTING_AUDIO;
        workflowManager.startStage(WorkflowProgressStage.CONVERTING_AUDIO);
        notify(ProgressStage.CONVERTING_AUDIO);
        FaultInjection.checkAndThrow("converting_audio", workflowManager, isRetry);

        const hasAudio = await this.ffmpegService.hasAudibleAudio(filePath);

        if (!hasAudio) {
          const errorMessage =
            "No audio detected in this video. Please re-record and make sure the correct microphone is selected and unmuted.";
          workflowManager.failStage(WorkflowProgressStage.CONVERTING_AUDIO, errorMessage);
          notify(ProgressStage.ERROR, { error: errorMessage });
          return { success: false, error: errorMessage };
        }

        mp3FilePath = await this.convertVideoToMp3(filePath);
        this.trackTempFile(mp3FilePath);

        workflowManager.completeStage(WorkflowProgressStage.CONVERTING_AUDIO);
        workflowManager.createCheckpoint(WorkflowProgressStage.CONVERTING_AUDIO, {
          mp3FilePath,
        });
      }

      // -- TRANSCRIBING --
      if (shouldRunStage(WorkflowProgressStage.TRANSCRIBING)) {
        currentStage = WorkflowProgressStage.TRANSCRIBING;
        workflowManager.startStage(WorkflowProgressStage.TRANSCRIBING);
        notify(ProgressStage.TRANSCRIBING);
        FaultInjection.checkAndThrow("transcribing", workflowManager, isRetry);

        if (!mp3FilePath) {
          throw new Error("Audio file path not available. Cannot transcribe.");
        }

        const transcriptionModelProvider = await TranscriptionModelProvider.getInstance();
        transcript = await transcriptionModelProvider.transcribeAudio(mp3FilePath);
        transcriptText = transcript.map((seg) => seg.text).join("");

        if (!transcriptText.trim()) {
          const errorMessage =
            "No speech detected in this recording. Please re-record and check your microphone and audio levels.";
          workflowManager.failStage(WorkflowProgressStage.TRANSCRIBING, errorMessage);
          notify(ProgressStage.ERROR, { error: errorMessage });
          return { success: false, error: errorMessage };
        }

        notify(ProgressStage.TRANSCRIPTION_COMPLETED, { transcript });
        workflowManager.completeStage(WorkflowProgressStage.TRANSCRIBING, transcriptText);
        workflowManager.createCheckpoint(WorkflowProgressStage.TRANSCRIBING, {
          transcript,
          transcriptText,
        });
      }

      // -- ANALYZING_TRANSCRIPT --
      if (shouldRunStage(WorkflowProgressStage.ANALYZING_TRANSCRIPT)) {
        currentStage = WorkflowProgressStage.ANALYZING_TRANSCRIPT;
        workflowManager.startStage(WorkflowProgressStage.ANALYZING_TRANSCRIPT);
        notify(ProgressStage.GENERATING_TASK);
        FaultInjection.checkAndThrow("analyzing_transcript", workflowManager, isRetry);

        if (!transcriptText) {
          throw new Error("Transcript not available. Cannot analyze.");
        }

        const languageModelProvider = await LanguageModelProvider.getInstance();

        const userPrompt = `Process the following transcript into a structured JSON object:

      ${transcriptText}`;

        intermediateOutput = await languageModelProvider.generateJson(
          userPrompt,
          INITIAL_SUMMARY_PROMPT,
        );

        workflowManager.completeStage(
          WorkflowProgressStage.ANALYZING_TRANSCRIPT,
          intermediateOutput,
        );
        workflowManager.createCheckpoint(WorkflowProgressStage.ANALYZING_TRANSCRIPT, {
          intermediateOutput,
        });
      }

      // -- SELECTING_PROMPT --
      if (shouldRunStage(WorkflowProgressStage.SELECTING_PROMPT)) {
        currentStage = WorkflowProgressStage.SELECTING_PROMPT;
        workflowManager.startStage(WorkflowProgressStage.SELECTING_PROMPT);
        FaultInjection.checkAndThrow("selecting_prompt", workflowManager, isRetry);

        if (!transcriptText) {
          throw new Error("Transcript not available. Cannot select prompt.");
        }

        const languageModelProvider = await LanguageModelProvider.getInstance();

        projectDetails = await PromptSelectionService.getInstance().getConfirmedProjectDetails(
          languageModelProvider,
          transcriptText,
        );

        ({ desktopAgentProjectPrompt, projectMetaData } =
          this.formatProjectDetails(projectDetails));

        workflowManager.completeStage(WorkflowProgressStage.SELECTING_PROMPT, projectDetails);
        workflowManager.createCheckpoint(WorkflowProgressStage.SELECTING_PROMPT, {
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
      }

      // -- EXECUTING_TASK --
      if (shouldRunStage(WorkflowProgressStage.EXECUTING_TASK)) {
        currentStage = WorkflowProgressStage.EXECUTING_TASK;
        workflowManager.startStage(WorkflowProgressStage.EXECUTING_TASK);
        FaultInjection.checkAndThrow("executing_task", workflowManager, isRetry);

        notify(ProgressStage.EXECUTING_TASK, { transcriptText, intermediateOutput });

        const serverFilter = projectDetails?.selectedMcpServerIds;

        const mcpAdapter = new McpWorkflowAdapter(workflowManager, {
          transcriptText,
          intermediateOutput,
        });

        const orchestrator = await MCPOrchestrator.getInstanceAsync();

        if (!transcriptText) {
          throw new Error("Transcript not available. Cannot execute task.");
        }

        mcpResult = await orchestrator.manualLoopAsync(transcriptText, youtubeResult, {
          projectMetaData,
          desktopAgentProjectPrompt,
          videoFilePath: filePath,
          serverFilter,
          onStep: mcpAdapter.onStep,
        });

        finalOutput = await this.formatFinalResult(mcpResult);
        mcpAdapter.complete(mcpResult);

        workflowManager.createCheckpoint(WorkflowProgressStage.EXECUTING_TASK, {
          mcpResult,
          finalOutput,
        });

        // Send to portal if authenticated
        if (mcpResult && (await MicrosoftAuthService.getInstance().isAuthenticated())) {
          const objectResult = await orchestrator.convertToObjectAsync(
            mcpResult,
            WorkItemDtoSchema,
          );
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
              console.warn(
                "[ProcessVideo] Failed to persist portal work item id",
                savePortalIdError,
              );
            }
          }
        }
      }

      // -- UPDATING_METADATA --
      let metadataUpdateError: string | undefined;

      if (
        shouldRunStage(WorkflowProgressStage.UPDATING_METADATA) &&
        youtubeResult.origin !== "external" &&
        youtubeResult.success
      ) {
        const videoId = youtubeResult.data?.videoId;
        if (videoId) {
          try {
            notify(ProgressStage.UPDATING_METADATA);
            workflowManager.updateStagePayload(
              WorkflowProgressStage.UPDATING_METADATA,
              null,
              "in_progress",
            );
            FaultInjection.checkAndThrow("updating_metadata", workflowManager, isRetry);
            const metadata = await this.metadataBuilder.build({
              transcript: transcript ?? [],
              intermediateOutput: intermediateOutput ?? "",
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
      // Mark the current stage as failed (if not already failed by fault injection)
      if (currentStage) {
        const stepState = workflowManager.getStepState(currentStage);
        if (stepState.status !== "failed") {
          workflowManager.failStage(currentStage, errorMessage);
        }
      }
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
}
