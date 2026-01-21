import fs from "node:fs";
import { BrowserWindow, type IpcMainInvokeEvent, ipcMain } from "electron";
import tmp from "tmp";
import { z } from "zod";
import { ProgressStage as WorkflowProgressStage } from "../../shared/types/workflow";
import { buildTaskExecutionPrompt, INITIAL_SUMMARY_PROMPT } from "../constants/prompts";
import { MicrosoftAuthService } from "../services/auth/microsoft-auth";
import type { VideoUploadResult } from "../services/auth/types";
import { YouTubeAuthService } from "../services/auth/youtube-auth";
import { FFmpegService } from "../services/ffmpeg/ffmpeg-service";
import { LanguageModelProvider } from "../services/mcp/language-model-provider";
import { MCPOrchestrator } from "../services/mcp/mcp-orchestrator";
import { TranscriptionModelProvider } from "../services/mcp/transcription-model-provider";
import { SendWorkItemDetailsToPortal, WorkItemDtoSchema } from "../services/portal/actions";
import { ShaveService } from "../services/shave/shave-service";
import { CustomPromptStorage } from "../services/storage/custom-prompt-storage";
import { VideoMetadataBuilder } from "../services/video/video-metadata-builder";
import { YouTubeDownloadService } from "../services/video/youtube-service";
import { McpWorkflowAdapter } from "../services/workflow/mcp-workflow-adapter";
import { WorkflowStateManager } from "../services/workflow/workflow-state-manager";
import { ProgressStage } from "../types";
import { formatErrorMessage } from "../utils/error-utils";
import { IPC_CHANNELS } from "./channels";

type VideoProcessingContext = {
  filePath: string;
  youtubeResult: VideoUploadResult;
  shaveId?: string;
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
  private readonly youtube = YouTubeAuthService.getInstance();
  private ffmpegService = FFmpegService.getInstance();
  private readonly customPromptStorage = CustomPromptStorage.getInstance();
  private readonly metadataBuilder: VideoMetadataBuilder;
  private readonly youtubeDownloadService = YouTubeDownloadService.getInstance();
  private lastVideoFilePath: string | undefined;

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
          notify(ProgressStage.EXECUTING_TASK);

          const customPrompt = await this.customPromptStorage.getActivePrompt();
          const systemPrompt = buildTaskExecutionPrompt(customPrompt?.content);
          const serverFilter = customPrompt?.selectedMcpServerIds;

          const filePath =
            this.lastVideoFilePath && fs.existsSync(this.lastVideoFilePath)
              ? this.lastVideoFilePath
              : undefined;

          const workflowManager = new WorkflowStateManager(shaveId);
          const mcpAdapter = new McpWorkflowAdapter(workflowManager);

          const orchestrator = await MCPOrchestrator.getInstanceAsync();
          const mcpResult = await orchestrator.manualLoopAsync(
            intermediateOutput,
            videoUploadResult,
            {
              systemPrompt,
              videoFilePath: filePath,
              serverFilter,
              onStep: mcpAdapter.onStep,
            },
          );

          mcpAdapter.complete(mcpResult);

          notify(ProgressStage.COMPLETED, {
            mcpResult,
            finalOutput: mcpResult,
          });
          return { success: true, finalOutput: mcpResult };
        } catch (error) {
          const errorMessage = formatErrorMessage(error);
          notify(ProgressStage.ERROR, { error: errorMessage });
          return { success: false, error: errorMessage };
        }
      },
    );
  }

  private async processFileVideo(filePath: string, shaveId?: string) {
    const notify = (stage: string, data?: Record<string, unknown>) => {
      this.emitProgress(stage, data, shaveId);
    };

    // check file exists
    if (!fs.existsSync(filePath)) {
      throw new Error("video-process-handler: Video file does not exist");
    }

    const workflowManager = new WorkflowStateManager(shaveId);
    workflowManager.startStage(WorkflowProgressStage.UPLOADING_VIDEO);
    workflowManager.skipStage(WorkflowProgressStage.DOWNLOADING_VIDEO);

    // upload to YouTube
    notify(ProgressStage.UPLOADING_SOURCE, {
      sourceOrigin: "upload",
    });

    try {
      const youtubeResult = await this.youtube.uploadVideo(filePath);
      workflowManager.completeStage(WorkflowProgressStage.UPLOADING_VIDEO, youtubeResult.data?.url);
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
      const errorMessage = formatErrorMessage(uploadError);
      workflowManager.failStage(WorkflowProgressStage.UPLOADING_VIDEO, errorMessage);
      return { success: false, error: errorMessage };
    }
  }

  private async processUrlVideo(url: string, shaveId?: string) {
    const notify = (stage: string, data?: Record<string, unknown>) => {
      this.emitProgress(stage, data, shaveId);
    };

    const workflowManager = new WorkflowStateManager(shaveId);
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
      workflowManager.completeStage(WorkflowProgressStage.DOWNLOADING_VIDEO);
      return await this.processVideoSource(
        {
          filePath,
          youtubeResult,
          shaveId,
        },
        workflowManager,
      );
    } catch (error) {
      const errorMessage = formatErrorMessage(error);
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
      const mp3FilePath = await this.convertVideoToMp3(filePath);

      workflowManager.completeStage(WorkflowProgressStage.CONVERTING_AUDIO);

      const transcriptionModelProvider = await TranscriptionModelProvider.getInstance();

      workflowManager.startStage(WorkflowProgressStage.TRANSCRIBING);
      notify(ProgressStage.TRANSCRIBING);
      const transcript = await transcriptionModelProvider.transcribeAudio(mp3FilePath);
      const transcriptText = transcript.map((seg) => seg.text).join("");

      notify(ProgressStage.TRANSCRIPTION_COMPLETED, { transcript });

      workflowManager.completeStage(WorkflowProgressStage.TRANSCRIBING, transcriptText);

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

      workflowManager.startStage(WorkflowProgressStage.EXECUTING_TASK);

      notify(ProgressStage.EXECUTING_TASK, { transcriptText, intermediateOutput });

      const customPrompt = await this.customPromptStorage.getActivePrompt();
      const systemPrompt = buildTaskExecutionPrompt(customPrompt?.content);
      const serverFilter = customPrompt?.selectedMcpServerIds;

      const mcpAdapter = new McpWorkflowAdapter(workflowManager, {
        transcriptText,
        intermediateOutput,
      });

      const orchestrator = await MCPOrchestrator.getInstanceAsync();
      const mcpResult = await orchestrator.manualLoopAsync(transcriptText, youtubeResult, {
        systemPrompt,
        videoFilePath: filePath,
        serverFilter,
        onStep: mcpAdapter.onStep,
      });

      mcpAdapter.complete(mcpResult);

      // if user logged in, send work item details to the portal
      if (mcpResult && (await MicrosoftAuthService.getInstance().isAuthenticated())) {
        const objectResult = await orchestrator.convertToObjectAsync(mcpResult, WorkItemDtoSchema);
        const portalResult = await SendWorkItemDetailsToPortal(
          WorkItemDtoSchema.parse(objectResult),
        );
        if (!portalResult.success) {
          console.warn("[ProcessVideo] Portal submission failed:", portalResult.error);
          const errorMessage = formatErrorMessage(portalResult.error);
          notify(ProgressStage.ERROR, { error: errorMessage });
          workflowManager.failStage(WorkflowProgressStage.UPDATING_METADATA, errorMessage);
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
            workflowManager.failStage(
              WorkflowProgressStage.UPDATING_METADATA,
              formatErrorMessage(metadataError),
            );
            metadataUpdateError = formatErrorMessage(metadataError);
          }
        }
      }

      notify(ProgressStage.COMPLETED, {
        transcript,
        intermediateOutput,
        mcpResult,
        finalOutput: mcpResult,
        uploadResult: youtubeResult,
        metadataUpdateError,
      });

      return { youtubeResult, mcpResult };
    } catch (error) {
      const errorMessage = formatErrorMessage(error);
      notify(ProgressStage.ERROR, { error: errorMessage });
      return { success: false, error: errorMessage };
    } finally {
      try {
        if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
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
        console.warn("[ProcessVideo] Failed to clean up source file", cleanupError);
      }
    }
  }

  private async convertVideoToMp3(inputPath: string): Promise<string> {
    const outputFilePath = tmp.tmpNameSync({ postfix: ".mp3" });
    const result = await this.ffmpegService.ConvertVideoToMp3(inputPath, outputFilePath);
    return result;
  }

  // TODO: Separate the Watch Video Pannel and Final Result Panel event triggers from this, and remove this event sender
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
}
