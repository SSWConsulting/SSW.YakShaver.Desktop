import fs from "node:fs";
import { BrowserWindow, type IpcMainInvokeEvent, ipcMain } from "electron";
import tmp from "tmp";
import { z } from "zod";
import type { TranscriptSegment } from "../../shared/types/transcript";
import {
  WORKFLOW_STAGE_ORDER,
  ProgressStage as WorkflowProgressStage,
  type WorkflowState,
} from "../../shared/types/workflow";
import { INITIAL_SUMMARY_PROMPT, TASK_EXECUTION_PROMPT } from "../constants/prompts";
import { IdentityServerAuthService } from "../services/auth/identity-server-auth";
import type { VideoUploadResult } from "../services/auth/types";
import { YouTubeClient } from "../services/auth/youtube-client";
import { FFmpegService } from "../services/ffmpeg/ffmpeg-service";
import { LanguageModelProvider } from "../services/mcp/language-model-provider";
import { MCPOrchestrator } from "../services/mcp/mcp-orchestrator";
import { TranscriptionModelProvider } from "../services/mcp/transcription-model-provider";
import { SendWorkItemDetailsToPortal, WorkItemDtoSchema } from "../services/portal/actions";
import type { ProjectDto } from "../services/prompt/prompt-manager";
import { ShaveService } from "../services/shave/shave-service";
import { UserInteractionService } from "../services/user-interaction/user-interaction-service";
import { VideoMetadataBuilder } from "../services/video/video-metadata-builder";
import { YouTubeDownloadService } from "../services/video/youtube-service";
import { McpWorkflowAdapter } from "../services/workflow/mcp-workflow-adapter";
import { PromptSelectionService } from "../services/workflow/prompt-selection-service";
import type { CheckpointData } from "../services/workflow/workflow-checkpoint-service";
import {
  type RetryResult,
  resolveCheckpointData,
  type VideoProcessingContext,
  validateCheckpointData,
  WorkflowRetryService,
} from "../services/workflow/workflow-retry-service";
import { WorkflowStateManager } from "../services/workflow/workflow-state-manager";
import { ProgressStage } from "../types";
import { formatAndReportError } from "../utils/error-utils";
import { IPC_CHANNELS } from "./channels";
import { id } from "zod/v4/locales";

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
  private tempFilesToCleanup: Map<string, string[]> = new Map();
  private workflowManagers: Map<string, WorkflowStateManager> = new Map();
  private readonly retryService: WorkflowRetryService;
  private activeRetries: Set<string> = new Set();
  private activeWorkflows: Set<string> = new Set();

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
      async (_event, filePath?: string, shaveId?: string, shaveAutoApprove?: boolean) => {
        if (!filePath) {
          throw new Error("video-process-handler: Video file path is required");
        }

        return await this.processFileVideo(filePath, shaveId, shaveAutoApprove);
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
              shaveId,
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
              shaveId,
              onStep: mcpAdapter.onStep,
            },
          );

          const finalOutput = await this.formatFinalResult(mcpResult);
          mcpAdapter.complete(mcpResult);

          notify(ProgressStage.COMPLETED, {
            mcpResult,
            finalOutput,
          });
          return {
            success: true,
            youtubeResult: videoUploadResult,
            mcpResult,
          } satisfies RetryResult;
        } catch (error) {
          const errorMessage = formatAndReportError(error, "rerun_task");
          notify(ProgressStage.ERROR, { error: errorMessage });
          return { success: false, error: errorMessage } satisfies RetryResult;
        }
      },
    );

    // Resume from failure: restores checkpoint data and re-runs from the failed stage onward.
    // Different from RERUN_TASK which is a user-initiated re-execution after success.
    ipcMain.handle(
      IPC_CHANNELS.WORKFLOW_RETRY_FROM_STAGE,
      async (_event: IpcMainInvokeEvent, stage: keyof WorkflowState, shaveId?: string) => {
        if (!WORKFLOW_STAGE_ORDER.includes(stage)) {
          return { success: false, error: `Invalid stage: ${stage}` };
        }
        if (shaveId && this.activeWorkflows.has(shaveId)) {
          return {
            success: false,
            error: "The workflow is still running. Please wait for it to finish.",
          };
        }
        if (shaveId && this.activeRetries.has(shaveId)) {
          return { success: false, error: "A retry is already in progress for this workflow." };
        }

        if (shaveId) this.activeRetries.add(shaveId);
        try {
          return await this.retryService.retryFromStage(stage, shaveId);
        } catch (error) {
          const errorMessage = formatAndReportError(error, "retry_from_stage");
          return { success: false, error: errorMessage };
        } finally {
          if (shaveId) this.activeRetries.delete(shaveId);
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
        await this.cleanupTempFiles(shaveId);
        return { success: true };
      } catch (error) {
        const errorMessage = formatAndReportError(error, "cancel_retry");
        return { success: false, error: errorMessage };
      }
    });
  }

  private async processFileVideo(filePath: string, shaveId?: string, shaveAutoApprove?: boolean) {
    const notify = (stage: string, data?: Record<string, unknown>) => {
      this.emitProgress(stage, data, shaveId);
    };

    // check file exists
    if (!fs.existsSync(filePath)) {
      throw new Error("video-process-handler: Video file does not exist");
    }

    const effectiveShaveId = shaveId || crypto.randomUUID();

    if (this.activeWorkflows.has(effectiveShaveId)) {
      return { success: false, error: "A workflow is already in progress for this shave." };
    }

    this.activeWorkflows.add(effectiveShaveId);
    try {
      const workflowManager = this.getOrCreateWorkflowManager(effectiveShaveId);
      this.workflowManagers.set(workflowManager.getWorkflowId(), workflowManager);

      this.lastVideoFilePath = filePath;
      this.trackTempFile(filePath, effectiveShaveId);

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
        const youtubeResult = await this.youtube.uploadVideo(filePath);

        if (youtubeResult.success && youtubeResult.data && duration) {
          youtubeResult.data.duration = duration;
        }

        workflowManager.completeStage(
          WorkflowProgressStage.UPLOADING_VIDEO,
          youtubeResult.data?.url,
        );

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
            shaveId: effectiveShaveId,
            shaveAutoApprove,
          },
          workflowManager,
        );
      } catch (uploadError) {
        const errorMessage = formatAndReportError(uploadError, "video_upload");
        workflowManager.failStage(WorkflowProgressStage.UPLOADING_VIDEO, errorMessage);
        return { success: false, error: errorMessage, workflowId: workflowManager.getWorkflowId() };
      }
    } finally {
      this.activeWorkflows.delete(effectiveShaveId);
    }
  }

  private async processUrlVideo(url: string, shaveId?: string) {
    const notify = (stage: string, data?: Record<string, unknown>) => {
      this.emitProgress(stage, data, shaveId);
    };

    const effectiveShaveId = shaveId || crypto.randomUUID();

    if (this.activeWorkflows.has(effectiveShaveId)) {
      return { success: false, error: "A workflow is already in progress for this shave." };
    }

    this.activeWorkflows.add(effectiveShaveId);
    try {
      const workflowManager = this.getOrCreateWorkflowManager(effectiveShaveId);
      this.workflowManagers.set(workflowManager.getWorkflowId(), workflowManager);

      workflowManager.skipStage(WorkflowProgressStage.UPLOADING_VIDEO);
      workflowManager.startStage(WorkflowProgressStage.DOWNLOADING_VIDEO);
      workflowManager.skipStage(WorkflowProgressStage.UPDATING_METADATA);

      // Save checkpoint before download so retry can find the URL
      workflowManager.createCheckpoint(WorkflowProgressStage.DOWNLOADING_VIDEO, {
        downloadUrl: url,
      });

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
        this.trackTempFile(filePath, effectiveShaveId);
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
            shaveId: effectiveShaveId,
          },
          workflowManager,
        );
      } catch (error) {
        const errorMessage = formatAndReportError(error, "video_download");
        workflowManager.failStage(WorkflowProgressStage.DOWNLOADING_VIDEO, errorMessage);
        notify(ProgressStage.ERROR, { error: errorMessage });
        return { success: false, error: errorMessage, workflowId: workflowManager.getWorkflowId() };
      }
    } finally {
      this.activeWorkflows.delete(effectiveShaveId);
    }
  }

  private async processVideoSource(
    { filePath, youtubeResult, shaveId, shaveAutoApprove }: VideoProcessingContext,
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

    const startIdx = startFromStage ? Math.max(0, WORKFLOW_STAGE_ORDER.indexOf(startFromStage)) : 0;

    const shouldRunStage = (stage: keyof WorkflowState) =>
      WORKFLOW_STAGE_ORDER.indexOf(stage) >= startIdx;

    // Resolve merged checkpoint data for skipped stages' outputs
    const checkpoint: CheckpointData =
      startIdx > 0 && startFromStage ? resolveCheckpointData(workflowManager, startFromStage) : {};

    // Validate checkpoint completeness before resuming from a failed stage
    if (startFromStage && startIdx > 0) {
      const { valid, missing } = validateCheckpointData(startFromStage, checkpoint);
      if (!valid) {
        const errorMessage = `Cannot resume from "${startFromStage}": missing data from prior stages (${missing.join(", ")}).`;
        notify(ProgressStage.ERROR, { error: errorMessage });
        return {
          success: false,
          error: errorMessage,
          workflowId: workflowManager.getWorkflowId(),
        };
      }
    }

    // Intentionally not cleared shaveAutoApprove after processing — the RETRY_VIDEO handler relies on the
    // persisted map entry to inherit auto-approve for the same shaveId without re-setting it.
    if (shaveId && shaveAutoApprove) {
      UserInteractionService.getInstance().setShaveAutoApprove(shaveId);
    }

    // Local variables — populated from stage execution or merged checkpoint
    let mp3FilePath: string | undefined = checkpoint.mp3FilePath;
    let transcript: TranscriptSegment[] | undefined = checkpoint.transcript;
    let transcriptText: string | undefined = checkpoint.transcriptText;
    let intermediateOutput: string | undefined = checkpoint.intermediateOutput;
    let projectDetails: (ProjectDto & { selectionReason: string, projectSource: "local" | "remote" }) | undefined | null =
      checkpoint.projectDetails as (ProjectDto & { selectionReason: string, projectSource: "local" | "remote" }) | undefined;
    let projectMetaData: string | undefined = checkpoint.projectMetaData;
    let desktopAgentProjectPrompt: string | undefined = checkpoint.desktopAgentProjectPrompt;
    let mcpResult: string | undefined = checkpoint.mcpResult;
    let finalOutput: string | undefined = checkpoint.finalOutput;

    let portalSubmissionError: string | undefined;
    let currentStage: keyof WorkflowState | null = null;

    try {
      this.lastVideoFilePath = filePath;

      // -- CONVERTING_AUDIO --
      if (shouldRunStage(WorkflowProgressStage.CONVERTING_AUDIO)) {
        currentStage = WorkflowProgressStage.CONVERTING_AUDIO;
        workflowManager.startStage(WorkflowProgressStage.CONVERTING_AUDIO);
        notify(ProgressStage.CONVERTING_AUDIO);

        const hasAudio = await this.ffmpegService.hasAudibleAudio(filePath);

        if (!hasAudio) {
          const errorMessage =
            "No audio detected in this video. Please re-record and make sure the correct microphone is selected and unmuted.";
          workflowManager.failStage(WorkflowProgressStage.CONVERTING_AUDIO, errorMessage);
          notify(ProgressStage.ERROR, { error: errorMessage });
          return {
            success: false,
            error: errorMessage,
            workflowId: workflowManager.getWorkflowId(),
          };
        }

        mp3FilePath = await this.convertVideoToMp3(filePath);
        this.trackTempFile(mp3FilePath, shaveId);

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

        const transcriptionModelProvider = await TranscriptionModelProvider.getInstance();
        // mp3FilePath guaranteed by: normal flow sets it in CONVERTING_AUDIO; retry validated at entry
        transcript = await transcriptionModelProvider.transcribeAudio(mp3FilePath as string);
        transcriptText = transcript.map((seg) => seg.text).join("");

        if (!transcriptText.trim()) {
          const errorMessage =
            "No speech detected in this recording. Please re-record and check your microphone and audio levels.";
          workflowManager.failStage(WorkflowProgressStage.TRANSCRIBING, errorMessage);
          notify(ProgressStage.ERROR, { error: errorMessage });
          return {
            success: false,
            error: errorMessage,
            workflowId: workflowManager.getWorkflowId(),
          };
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

        const languageModelProvider = await LanguageModelProvider.getInstance();

        // transcriptText guaranteed by: normal flow sets it in TRANSCRIBING; retry validated at entry
        const userPrompt = `Process the following transcript into a structured JSON object:

      ${transcriptText as string}`;

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

        const languageModelProvider = await LanguageModelProvider.getInstance();

        // Select project prompt based on transcript
        // transcriptText guaranteed by: normal flow sets it in TRANSCRIBING; retry validated at entry
        projectDetails = await PromptSelectionService.getInstance().getConfirmedProjectDetails(
          languageModelProvider,
          transcriptText as string,
          shaveId,
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

        notify(ProgressStage.EXECUTING_TASK, { transcriptText, intermediateOutput });

        const serverFilter = projectDetails?.selectedMcpServerIds;

        const mcpAdapter = new McpWorkflowAdapter(workflowManager, {
          transcriptText,
          intermediateOutput,
        });

        const orchestrator = await MCPOrchestrator.getInstanceAsync();

        // transcriptText guaranteed by: normal flow sets it in TRANSCRIBING; retry validated at entry
        mcpResult = await orchestrator.manualLoopAsync(transcriptText as string, youtubeResult, {
          projectMetaData,
          desktopAgentProjectPrompt,
          videoFilePath: filePath,
          serverFilter,
          shaveId,
          onStep: mcpAdapter.onStep,
        });

        finalOutput = await this.formatFinalResult(mcpResult);
        mcpAdapter.complete(mcpResult);

        workflowManager.createCheckpoint(WorkflowProgressStage.EXECUTING_TASK, {
          mcpResult,
          finalOutput,
        });

        // Send to portal if authenticated and project is remote — non-fatal, does not affect workflow stage status
        // local projects don't have portal project IDs so not sent to portal regardless of auth status
        if (mcpResult && projectDetails?.projectSource === "remote" && projectDetails?.id
          && (await IdentityServerAuthService.getInstance().isAuthenticated())) {
          try {
            const objectResult = await orchestrator.convertToObjectAsync(
              mcpResult,
              WorkItemDtoSchema,
            );
            const workItemDto = WorkItemDtoSchema.parse(objectResult);
            workItemDto.projectId = projectDetails.id;
            workItemDto.projectName = projectDetails.name;
            
            const portalResult = await SendWorkItemDetailsToPortal(
              workItemDto,
            );
            if (!portalResult.success) {
              console.warn("[ProcessVideo] Portal submission failed:", portalResult.error);
              portalSubmissionError = formatAndReportError(portalResult.error, "portal_submission");
              notify(ProgressStage.ERROR, { error: portalSubmissionError });
            } else if (shaveId) {
              const shaveService = ShaveService.getInstance();
              shaveService.updateShave(shaveId, { portalWorkItemId: portalResult.workItemId });
            }
          } catch (portalError) {
            console.warn("[ProcessVideo] Portal submission error:", portalError);
            portalSubmissionError = formatAndReportError(portalError, "portal_submission");
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
        portalSubmissionError,
      });

      // Clean up temp files and mark DB records on successful completion
      await this.cleanupTempFiles(shaveId);

      const workflowId = workflowManager.getWorkflowId();
      return { success: true, youtubeResult, mcpResult, workflowId };
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
      return { success: false, error: errorMessage, workflowId: workflowManager.getWorkflowId() };
    } finally {
      // Note: Temp files and DB records are NOT cleaned up here on failure.
      // They are preserved for potential retry and cleaned up only on success
      // via cleanupTempFiles() or when user cancels the workflow.
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

  private static readonly MAX_FAILED_WORKFLOW_MANAGERS = 100;

  private getOrCreateWorkflowManager(shaveId: string): WorkflowStateManager {
    let manager = this.workflowManagers.get(shaveId);
    if (!manager) {
      this.evictStaleWorkflowManagers();
      manager = new WorkflowStateManager(shaveId);
      this.workflowManagers.set(shaveId, manager);
    }
    return manager;
  }

  /**
   * Evict completed workflows immediately (they don't need retry).
   * If failed workflows exceed the limit, evict the oldest ones.
   */
  private evictStaleWorkflowManagers(): void {
    const failedKeys: string[] = [];

    for (const [key, mgr] of this.workflowManagers.entries()) {
      const state = mgr.getState();
      const hasFailed = WORKFLOW_STAGE_ORDER.some((s) => state[s].status === "failed");

      if (hasFailed) {
        failedKeys.push(key);
      } else {
        // Completed or in-progress-but-stale — safe to evict
        const hasInProgress = WORKFLOW_STAGE_ORDER.some((s) => state[s].status === "in_progress");
        if (!hasInProgress) {
          mgr.clearAllCheckpoints();
          this.workflowManagers.delete(key);
          this.tempFilesToCleanup.delete(key);
        }
      }
    }

    // If too many failed workflows, evict oldest
    while (failedKeys.length > ProcessVideoIPCHandlers.MAX_FAILED_WORKFLOW_MANAGERS) {
      const oldestKey = failedKeys.shift();
      if (oldestKey) {
        const oldManager = this.workflowManagers.get(oldestKey);
        oldManager?.clearAllCheckpoints();
        this.workflowManagers.delete(oldestKey);
        this.tempFilesToCleanup.delete(oldestKey);
      }
    }
  }

  private trackTempFile(filePath: string, shaveId?: string): void {
    const key = shaveId ?? "_global";
    const files = this.tempFilesToCleanup.get(key) ?? [];
    if (!files.includes(filePath)) {
      files.push(filePath);
      this.tempFilesToCleanup.set(key, files);
    }
  }

  async cleanupAllTempFiles(): Promise<void> {
    const keys = [...this.tempFilesToCleanup.keys()];
    for (const key of keys) {
      const shaveId = key === "_global" ? undefined : key;
      await this.cleanupTempFiles(shaveId);
    }
  }

  private async cleanupTempFiles(shaveId?: string): Promise<void> {
    const key = shaveId ?? "_global";
    const files = this.tempFilesToCleanup.get(key) ?? [];

    for (const filePath of files) {
      try {
        await fs.promises.access(filePath);
        await fs.promises.unlink(filePath);
      } catch (error) {
        console.warn(`[ProcessVideo] Failed to cleanup temp file: ${filePath}`, error);
      }
    }
    this.tempFilesToCleanup.delete(key);

    if (shaveId) {
      // Mark video files as deleted in database only when files are actually cleaned up
      try {
        const shaveService = ShaveService.getInstance();
        shaveService.markShaveVideoFilesAsDeleted(shaveId);
      } catch (dbError) {
        console.warn("[ProcessVideo] Failed to mark video files as deleted", dbError);
      }

      // Remove workflow manager and its checkpoints — no longer needed after cleanup
      const manager = this.workflowManagers.get(shaveId);
      if (manager) {
        manager.clearAllCheckpoints();
      }
      this.workflowManagers.delete(shaveId);
    }
  }
}
