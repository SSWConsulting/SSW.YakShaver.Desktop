import fs from "node:fs";
import { type IpcMainInvokeEvent, ipcMain } from "electron";
import tmp from "tmp";
import { z } from "zod";
import type { TranscriptSegment } from "../../shared/types/transcript";
import {
  WORKFLOW_STAGE_ORDER,
  ProgressStage as WorkflowProgressStage,
  type WorkflowState,
} from "../../shared/types/workflow";
import type { OrchestratorBackend } from "../../shared/types/workflow-payloads";
import { INITIAL_SUMMARY_PROMPT, TASK_EXECUTION_PROMPT } from "../constants/prompts";
import { IdentityServerAuthService } from "../services/auth/identity-server-auth";
import type { VideoUploadResult } from "../services/auth/types";
import { YouTubeClient } from "../services/auth/youtube-client";
import { FFmpegService } from "../services/ffmpeg/ffmpeg-service";
import type { IBacklogOrchestrator } from "../services/mcp/backlog-orchestrator";
import { LanguageModelProvider } from "../services/mcp/language-model-provider";
import { LocalClaudeOrchestrator } from "../services/mcp/local-claude-orchestrator";
import { MCPOrchestrator } from "../services/mcp/mcp-orchestrator";
import { TranscriptionModelProvider } from "../services/mcp/transcription-model-provider";
import { SendWorkItemDetailsToPortal, WorkItemDtoSchema } from "../services/portal/actions";
import type { ProjectDto } from "../services/prompt/prompt-manager";
import { ShaveService } from "../services/shave/shave-service";
import { LlmStorage } from "../services/storage/llm-storage";
import { optimizeTranscript } from "../services/transcript/optimize-transcript-service";
import { UserInteractionService } from "../services/user-interaction/user-interaction-service";
import { VideoMetadataBuilder } from "../services/video/video-metadata-builder";
import { YouTubeDownloadService } from "../services/video/youtube-service";
import { McpWorkflowAdapter } from "../services/workflow/mcp-workflow-adapter";
import { formatNoWorkItemError } from "../services/workflow/no-work-item-error";
import { PromptSelectionService } from "../services/workflow/prompt-selection-service";
import {
  applyPortalVideoFields,
  applyVideoMetadataPersistence,
} from "../services/workflow/video-metadata-persistence";
import type { CheckpointData } from "../services/workflow/workflow-checkpoint-service";
import {
  type RetryResult,
  resolveCheckpointData,
  type VideoProcessingContext,
  validateCheckpointData,
  WorkflowRetryService,
} from "../services/workflow/workflow-retry-service";
import { WorkflowStateManager } from "../services/workflow/workflow-state-manager";
import {
  applyUploadStageOutcome,
  resolveMetadataStage,
  shouldFailStageOnUnexpectedError,
} from "../services/workflow/youtube-stage-decisions";
import { formatAndReportError } from "../utils/error-utils";
import { IPC_CHANNELS } from "./channels";
import { runCloud360Path, shouldUseCloud360 } from "./process-video-cloud360";

export type { RetryResult, VideoProcessingContext };

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
      trackTempFile: this.trackTempFile.bind(this),
      getLastVideoFilePath: () => this.lastVideoFilePath,
      getOrCreateWorkflowManager: this.getOrCreateWorkflowManager.bind(this),
    });
    this.registerHandlers();
  }

  private registerHandlers(): void {
    ipcMain.handle(
      IPC_CHANNELS.PROCESS_VIDEO_FILE,
      async (
        _event,
        filePath?: string,
        shaveId?: string,
        shaveAutoApprove?: boolean,
        projectId?: string,
        durationSeconds?: number,
      ) => {
        if (!filePath) {
          throw new Error("video-process-handler: Video file path is required");
        }
        if (await shouldUseCloud360()) {
          return await runCloud360Path(filePath, shaveId, projectId, durationSeconds);
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

          const serverFilter = projectDetails?.selectedMcpServerIds;

          const filePath =
            this.lastVideoFilePath && fs.existsSync(this.lastVideoFilePath)
              ? this.lastVideoFilePath
              : undefined;

          const { orchestrator, backend } = await this.getBacklogOrchestrator();

          const mcpAdapter = new McpWorkflowAdapter(workflowManager, {
            orchestrator: backend,
          });

          const loopResult = await orchestrator.manualLoopAsync(
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

          const mcpResult = loopResult.text;
          const finalOutput = await this.formatFinalResult(mcpResult);

          // #833: only report success if a backlog item was actually created/updated.
          if (!loopResult.backlogActionSucceeded) {
            const failureMessage = formatNoWorkItemError(loopResult.terminationReason);
            mcpAdapter.fail(mcpResult, finalOutput, failureMessage);
            workflowManager.skipStage(WorkflowProgressStage.UPDATING_METADATA);
            return { success: false, error: failureMessage } satisfies RetryResult;
          }

          mcpAdapter.complete(mcpResult, finalOutput);
          workflowManager.skipStage(WorkflowProgressStage.UPDATING_METADATA);

          return {
            success: true,
            youtubeResult: videoUploadResult,
            mcpResult,
          } satisfies RetryResult;
        } catch (error) {
          const errorMessage = formatAndReportError(error, "rerun_task");
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

      try {
        const youtubeResult = await this.youtube.uploadVideo(filePath);

        if (youtubeResult.success && youtubeResult.data && duration) {
          youtubeResult.data.duration = duration;
        }

        // #672: only show a green tick when the upload actually succeeded. uploadVideo returns
        // { success:false } (without throwing) when e.g. the Google account has no YouTube
        // channel — previously that still completed the stage, leaving a green tick and no link.
        // Mark it failed (so the user sees why) but keep going: the work item is still worth creating.
        applyUploadStageOutcome(youtubeResult, filePath, workflowManager);

        // Update checkpoint with upload result
        workflowManager.createCheckpoint(WorkflowProgressStage.UPLOADING_VIDEO, {
          filePath,
          youtubeResult,
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
        const filePath = await this.youtubeDownloadService.downloadVideoToFile(url);
        this.trackTempFile(filePath, effectiveShaveId);
        this.lastVideoFilePath = filePath;

        workflowManager.completeStage(WorkflowProgressStage.DOWNLOADING_VIDEO, {
          downloadUrl: url,
          filePath,
          sourceOrigin: "external",
          uploadResult: youtubeResult,
        });

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
    let optimizedTranscriptText: string | undefined = checkpoint.optimizedTranscriptText;
    let intermediateOutput: string | undefined = checkpoint.intermediateOutput;
    let projectDetails:
      | (ProjectDto & { selectionReason: string; projectSource: "local" | "remote" })
      | undefined
      | null = checkpoint.projectDetails as
      | (ProjectDto & { selectionReason: string; projectSource: "local" | "remote" })
      | undefined;
    let projectMetaData: string | undefined = checkpoint.projectMetaData;
    let desktopAgentProjectPrompt: string | undefined = checkpoint.desktopAgentProjectPrompt;
    let mcpResult: string | undefined = checkpoint.mcpResult;
    let finalOutput: string | undefined = checkpoint.finalOutput;

    let currentStage: keyof WorkflowState | null = null;

    try {
      this.lastVideoFilePath = filePath;

      // #808: Persist the video embed URL / source onto the shave record directly from the
      // authoritative upload result. The UI normally writes this in response to a workflow
      // progress event, but that event can be missed or coalesced (e.g. the workflow advances
      // past `uploading_video` before the renderer subscribes, or the renderer's in-memory
      // dedup set drops it), leaving the saved shave without `videoEmbedUrl`/`videoFile` and so
      // with no preview in the Tenant view. Writing it here from the backend guarantees the
      // field is persisted whenever the upload/download succeeded, regardless of UI timing.
      this.persistVideoMetadataToShave(shaveId, youtubeResult);

      // -- CONVERTING_AUDIO --
      if (shouldRunStage(WorkflowProgressStage.CONVERTING_AUDIO)) {
        currentStage = WorkflowProgressStage.CONVERTING_AUDIO;
        workflowManager.startStage(WorkflowProgressStage.CONVERTING_AUDIO);

        const hasAudio = await this.ffmpegService.hasAudibleAudio(filePath);

        if (!hasAudio) {
          const errorMessage =
            "No audio detected in this video. Please re-record and make sure the correct microphone is selected and unmuted.";
          workflowManager.failStage(WorkflowProgressStage.CONVERTING_AUDIO, errorMessage);
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

        const transcriptionModelProvider = await TranscriptionModelProvider.getInstance();
        // mp3FilePath guaranteed by: normal flow sets it in CONVERTING_AUDIO; retry validated at entry
        transcript = await transcriptionModelProvider.transcribeAudio(mp3FilePath as string);
        transcriptText = transcript.map((seg) => seg.text).join("");

        if (!transcriptText.trim()) {
          const errorMessage =
            "No speech detected in this recording. Please re-record and check your microphone and audio levels.";
          workflowManager.failStage(WorkflowProgressStage.TRANSCRIBING, errorMessage);
          return {
            success: false,
            error: errorMessage,
            workflowId: workflowManager.getWorkflowId(),
          };
        }

        workflowManager.completeStage(WorkflowProgressStage.TRANSCRIBING, transcriptText);
        workflowManager.createCheckpoint(WorkflowProgressStage.TRANSCRIBING, {
          transcript,
          transcriptText,
        });
      }

      // -- OPTIMIZING_TRANSCRIPT --
      if (shouldRunStage(WorkflowProgressStage.OPTIMIZING_TRANSCRIPT)) {
        currentStage = WorkflowProgressStage.OPTIMIZING_TRANSCRIPT;
        workflowManager.startStage(WorkflowProgressStage.OPTIMIZING_TRANSCRIPT);

        try {
          const languageModelProvider = await LanguageModelProvider.getInstance();
          // transcriptText guaranteed by: normal flow sets it in TRANSCRIBING; retry validated at entry
          optimizedTranscriptText = await optimizeTranscript(
            transcriptText as string,
            languageModelProvider,
          );
        } catch (optimizeError) {
          // Non-fatal: if optimization fails, fall back to the raw transcript so the workflow can continue.
          // Still report to telemetry (like every other non-fatal catch in this file) so failures are
          // observable instead of silently swallowed.
          const optimizeErrorMessage = formatAndReportError(
            optimizeError,
            "transcript_optimization",
          );
          console.warn(
            "[ProcessVideo] Transcript optimization failed, using raw transcript:",
            optimizeErrorMessage,
          );
          optimizedTranscriptText = transcriptText as string;
        }

        workflowManager.completeStage(
          WorkflowProgressStage.OPTIMIZING_TRANSCRIPT,
          optimizedTranscriptText,
        );
        workflowManager.createCheckpoint(WorkflowProgressStage.OPTIMIZING_TRANSCRIPT, {
          optimizedTranscriptText,
        });
      }

      // -- ANALYZING_TRANSCRIPT --
      if (shouldRunStage(WorkflowProgressStage.ANALYZING_TRANSCRIPT)) {
        currentStage = WorkflowProgressStage.ANALYZING_TRANSCRIPT;
        workflowManager.startStage(WorkflowProgressStage.ANALYZING_TRANSCRIPT);

        const languageModelProvider = await LanguageModelProvider.getInstance();

        // Use optimized transcript if available; fall back to raw transcriptText (logged).
        const effectiveTranscript = this.resolveEffectiveTranscript(
          optimizedTranscriptText,
          transcriptText,
          "ANALYZING_TRANSCRIPT",
        );
        const userPrompt = `Process the following transcript into a structured JSON object:

      ${effectiveTranscript}`;

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

        // Select project prompt based on transcript (use optimized if available, logged on fallback)
        projectDetails = await PromptSelectionService.getInstance().getConfirmedProjectDetails(
          languageModelProvider,
          this.resolveEffectiveTranscript(
            optimizedTranscriptText,
            transcriptText,
            "SELECTING_PROMPT",
          ),
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

        const serverFilter = projectDetails?.selectedMcpServerIds;

        const { orchestrator, backend } = await this.getBacklogOrchestrator();

        // Use optimized transcript if available for the task execution loop (logged on fallback);
        // keep the adapter's audit/UI payload consistent with what actually drives execution below.
        const effectiveExecutionTranscript = this.resolveEffectiveTranscript(
          optimizedTranscriptText,
          transcriptText,
          "EXECUTING_TASK",
        );

        const mcpAdapter = new McpWorkflowAdapter(workflowManager, {
          transcriptText: effectiveExecutionTranscript,
          intermediateOutput,
          orchestrator: backend,
        });

        const loopResult = await orchestrator.manualLoopAsync(
          effectiveExecutionTranscript,
          youtubeResult,
          {
            projectMetaData,
            desktopAgentProjectPrompt,
            videoFilePath: filePath,
            serverFilter,
            shaveId,
            onStep: mcpAdapter.onStep,
          },
        );

        mcpResult = loopResult.text;
        finalOutput = await this.formatFinalResult(mcpResult);

        // #833: the model finishing politely is NOT success. Unless a tool call actually
        // created/updated a backlog item, the run did nothing — fail the stage so the user
        // isn't told an issue exists when none does. Temp files are kept for retry.
        if (!loopResult.backlogActionSucceeded) {
          const failureMessage = formatNoWorkItemError(loopResult.terminationReason, {
            verificationUnavailable: loopResult.verificationUnavailable,
          });
          mcpAdapter.fail(mcpResult, finalOutput, failureMessage);
          workflowManager.createCheckpoint(WorkflowProgressStage.EXECUTING_TASK, {
            mcpResult,
            finalOutput,
          });
          return {
            success: false,
            error: failureMessage,
            workflowId: workflowManager.getWorkflowId(),
          };
        }

        mcpAdapter.complete(mcpResult, finalOutput);

        workflowManager.createCheckpoint(WorkflowProgressStage.EXECUTING_TASK, {
          mcpResult,
          finalOutput,
        });

        // Send to portal if authenticated and project is remote — non-fatal, does not affect workflow stage status
        // local projects don't have portal project IDs so not sent to portal regardless of auth status
        //
        // #306: the authenticated-ness check itself now lives INSIDE the try below (rather than
        // as an unguarded `await` in this `if` condition). isAuthenticated() currently swallows
        // its own errors, but evaluating it ahead of the try meant a future change there (or any
        // other guard added to this condition) could throw with currentStage still pinned at
        // EXECUTING_TASK, which the outer catch would then incorrectly re-fail. Keeping every
        // await for this block inside the try removes that class of escape hatch entirely.
        if (mcpResult && projectDetails?.projectSource === "remote" && projectDetails?.id) {
          try {
            const isPortalAuthenticated =
              await IdentityServerAuthService.getInstance().isAuthenticated();

            if (isPortalAuthenticated) {
              // Portal serialization uses the OpenAI orchestrator's structured-output helper
              // regardless of which backend drove the loop (the local Claude backend has no
              // convertToObjectAsync). This is a separate LLM call from the orchestration step.
              const portalOrchestrator = await MCPOrchestrator.getInstanceAsync();
              const objectResult = await portalOrchestrator.convertToObjectAsync(
                mcpResult,
                WorkItemDtoSchema,
              );
              const workItemDto = WorkItemDtoSchema.parse(objectResult);
              workItemDto.projectId = projectDetails.id;
              workItemDto.projectName = projectDetails.name;

              // #808: The Tenant view renders its preview from the portal payload's video fields.
              // These were previously left to the LLM to copy out of the system prompt during
              // structured extraction, which intermittently dropped them — the exact "missing
              // embedUrl/videoFile" symptom #808 reports. Override them deterministically from the
              // same authoritative upload result the local backstop uses, so a successful
              // recording ALWAYS carries the embed URL to the portal regardless of model output.
              // The override + its skip-on-null behaviour lives in applyPortalVideoFields so the
              // wiring (and that it fires BEFORE the portal POST) is unit-testable.
              applyPortalVideoFields(workItemDto, youtubeResult);

              const portalResult = await SendWorkItemDetailsToPortal(workItemDto);
              if (!portalResult.success) {
                console.warn("[ProcessVideo] Portal submission failed:", portalResult.error);
                formatAndReportError(portalResult.error, "portal_submission");
              } else if (shaveId) {
                const shaveService = ShaveService.getInstance();
                // Sync the canonical portal data back to the local record so both
                // stores stay in sync even if the workflow fails after this point.
                shaveService.updateShave(shaveId, {
                  portalWorkItemId: portalResult.workItemId,
                  title: workItemDto.title,
                  projectName: workItemDto.projectName,
                  workItemUrl: workItemDto.workItemUrl,
                });
              }
            }
          } catch (portalError) {
            console.warn("[ProcessVideo] Portal submission error:", portalError);
            formatAndReportError(portalError, "portal_submission");
          }
        }
      }

      if (shouldRunStage(WorkflowProgressStage.UPDATING_METADATA)) {
        // #306: advance currentStage here too (like every earlier stage does) so an
        // exception that somehow escapes this block's own try/catch is attributed to
        // UPDATING_METADATA rather than staying pinned on the already-completed
        // EXECUTING_TASK — which the outer catch below would otherwise silently flip
        // back to "failed", permanently blocking isWorkflowReadyForFinalOutput (it
        // requires executing_task to stay "completed") even though the actual task
        // (issue creation) already succeeded.
        currentStage = WorkflowProgressStage.UPDATING_METADATA;
        const videoId = resolveMetadataStage(youtubeResult, workflowManager);
        if (videoId) {
          try {
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
            workflowManager.updateStagePayload(
              WorkflowProgressStage.UPDATING_METADATA,
              metadata.metadata,
              "in_progress",
            );
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
          }
        }
      }

      // Clean up temp files and mark DB records on successful completion
      await this.cleanupTempFiles(shaveId);

      const workflowId = workflowManager.getWorkflowId();
      return { success: true, youtubeResult, mcpResult, workflowId };
    } catch (error) {
      const errorMessage = formatAndReportError(error, "video_processing");
      // #306: only mark currentStage as failed if it was genuinely interrupted
      // mid-flight — see shouldFailStageOnUnexpectedError for why a stage that already
      // reached "completed"/"skipped" must not be retroactively re-failed here.
      if (currentStage) {
        const stepState = workflowManager.getStepState(currentStage);
        if (shouldFailStageOnUnexpectedError(stepState.status)) {
          workflowManager.failStage(currentStage, errorMessage);
        }
      }
      return { success: false, error: errorMessage, workflowId: workflowManager.getWorkflowId() };
    } finally {
      // Note: Temp files and DB records are NOT cleaned up here on failure.
      // They are preserved for potential retry and cleaned up only on success
      // via cleanupTempFiles() or when user cancels the workflow.
    }
  }

  /**
   * #808: Backstop that persists the authoritative video metadata from the upload/download
   * result onto the shave record, independent of the UI workflow-progress listener.
   *
   * - For uploads (origin !== "external"), the embed URL is `youtubeResult.data.url`; it is
   *   written to `videoEmbedUrl` only when the shave doesn't already have one, so it never
   *   clobbers a value the UI (or metadata-update) already set.
   * - For external sources, a video source row is attached via the idempotent
   *   `attachVideoSourceToShave` (which is a no-op if a source is already linked).
   *
   * Best-effort and fully non-fatal: any failure here must not abort the workflow, since the
   * UI listener remains a second path to the same write.
   */
  private persistVideoMetadataToShave(
    shaveId: string | undefined,
    youtubeResult: VideoUploadResult,
  ): void {
    if (!shaveId) {
      return;
    }

    try {
      // The decision + ShaveService wiring lives in applyVideoMetadataPersistence so it can be
      // unit-tested against an in-memory store (proving the no-clobber and write branches).
      applyVideoMetadataPersistence(ShaveService.getInstance(), shaveId, youtubeResult);
    } catch (err) {
      // Non-fatal — the UI progress listener is the other path to this write.
      console.warn(
        "[ProcessVideo] Failed to persist video metadata to shave (non-fatal):",
        formatAndReportError(err, "persist_video_metadata"),
      );
    }
  }

  private async convertVideoToMp3(inputPath: string): Promise<string> {
    const outputFilePath = tmp.tmpNameSync({ postfix: ".mp3" });
    const result = await this.ffmpegService.ConvertVideoToMp3(inputPath, outputFilePath);
    return result;
  }

  /**
   * Selects the orchestrator backend for the backlog-creation step from the persisted LLM config.
   * `local-claude` drives the step with a headless `claude -p`; anything else (including a config
   * with no `orchestrationBackend` field) uses the in-process OpenAI loop. Falls back to OpenAI if
   * the config can't be read so the stage never hard-fails on a config hiccup.
   *
   * Returns the chosen orchestrator alongside a UI-facing `backend` label (stamped into the
   * Executing Task payload so the stage card can badge which orchestrator is active).
   */
  private async getBacklogOrchestrator(): Promise<{
    orchestrator: IBacklogOrchestrator;
    backend: OrchestratorBackend;
  }> {
    let configuredBackend: string | undefined;
    try {
      configuredBackend = (await LlmStorage.getInstance().getLLMConfig())?.orchestrationBackend;
    } catch (error) {
      console.warn(
        "[ProcessVideo] Failed to read orchestration backend, defaulting to OpenAI",
        error,
      );
    }

    if (configuredBackend === "local-claude") {
      console.log("[ProcessVideo] Using local Claude Code orchestrator");
      return { orchestrator: new LocalClaudeOrchestrator(), backend: "claude-code" };
    }

    return { orchestrator: await MCPOrchestrator.getInstanceAsync(), backend: "openai" };
  }

  /**
   * Resolves the effective transcript to use downstream of OPTIMIZING_TRANSCRIPT: prefers the
   * optimized transcript, falling back to the raw transcript when it's unavailable (e.g. a retry
   * resumed without an OPTIMIZING_TRANSCRIPT checkpoint). Logs when the fallback path is taken so
   * a retry silently regressing to un-optimized text isn't invisible (see workflow-retry-service's
   * STAGE_REQUIRED_INPUTS, which doesn't yet require optimizedTranscriptText downstream).
   */
  private resolveEffectiveTranscript(
    optimizedTranscriptText: string | undefined,
    transcriptText: string | undefined,
    stage: string,
  ): string {
    if (optimizedTranscriptText !== undefined) {
      return optimizedTranscriptText;
    }
    console.warn(
      `[ProcessVideo] optimizedTranscriptText unavailable at ${stage}; falling back to raw transcriptText`,
    );
    // transcriptText guaranteed by: normal flow sets it in TRANSCRIBING; retry validated at entry
    return transcriptText as string;
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
