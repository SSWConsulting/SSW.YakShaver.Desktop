import fs from "node:fs";
import { BrowserWindow, type IpcMainInvokeEvent, ipcMain } from "electron";
import tmp from "tmp";
import { z } from "zod";
import { MicrosoftAuthService } from "../services/auth/microsoft-auth";
import type { VideoUploadResult } from "../services/auth/types";
import { YouTubeAuthService } from "../services/auth/youtube-auth";
import { FFmpegService } from "../services/ffmpeg/ffmpeg-service";
import { LLMClientProvider } from "../services/mcp/llm-client-provider";
import { MCPOrchestrator } from "../services/mcp/mcp-orchestrator";
import { OpenAIService } from "../services/openai/openai-service";
import { buildTaskExecutionPrompt, INITIAL_SUMMARY_PROMPT } from "../services/openai/prompts";
import { SendWorkItemDetailsToPortal, WorkItemDtoSchema } from "../services/portal/actions";
import { ShaveService } from "../services/shave/shave-service";
import { CustomPromptStorage } from "../services/storage/custom-prompt-storage";
import {
  parseVtt,
  type TranscriptSegment,
  VideoMetadataBuilder,
} from "../services/video/video-metadata-builder";
import { YouTubeDownloadService } from "../services/video/youtube-service";
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
  private readonly llmClient = OpenAIService.getInstance(); // TODO: make generic interface for different LLMs https://github.com/SSWConsulting/SSW.YakShaver/issues/3011
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

          const filePath =
            this.lastVideoFilePath && fs.existsSync(this.lastVideoFilePath)
              ? this.lastVideoFilePath
              : undefined;

          const orchestrator = await MCPOrchestrator.getInstanceAsync();
          const mcpResult = await orchestrator.manualLoopAsync(
            intermediateOutput,
            videoUploadResult,
            filePath
              ? {
                  systemPrompt,
                  videoFilePath: filePath,
                }
              : { systemPrompt },
          );

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

    // upload to YouTube
    notify(ProgressStage.UPLOADING_SOURCE, {
      sourceOrigin: "upload",
    });
    const youtubeResult = await this.youtube.uploadVideo(filePath);
    notify(ProgressStage.UPLOAD_COMPLETED, {
      uploadResult: youtubeResult,
      sourceOrigin: youtubeResult.origin,
    });

    return await this.processVideoSource({
      filePath,
      youtubeResult,
      shaveId,
    });
  }

  private async processUrlVideo(url: string, shaveId?: string) {
    const notify = (stage: string, data?: Record<string, unknown>) => {
      this.emitProgress(stage, data, shaveId);
    };

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
      return await this.processVideoSource({
        filePath,
        youtubeResult,
        shaveId,
      });
    } catch (error) {
      const errorMessage = formatErrorMessage(error);
      notify(ProgressStage.ERROR, { error: errorMessage });
      return { success: false, error: errorMessage };
    }
  }

  private async processVideoSource({ filePath, youtubeResult, shaveId }: VideoProcessingContext) {
    // check file exists
    if (!fs.existsSync(filePath)) {
      throw new Error("video-process-handler: Video file does not exist");
    }

    const notify = (stage: string, data?: Record<string, unknown>) => {
      this.emitProgress(stage, data, shaveId);
    };

    try {
      this.lastVideoFilePath = filePath;
      notify(ProgressStage.CONVERTING_AUDIO);
      const mp3FilePath = await this.convertVideoToMp3(filePath);

      notify(ProgressStage.TRANSCRIBING);
      const transcript = await this.llmClient.transcribeAudio(mp3FilePath);
      notify(ProgressStage.TRANSCRIPTION_COMPLETED, { transcript });

      const transcriptText = parseVtt(transcript)
        .map((segment: TranscriptSegment) => segment.text)
        .join(" ");

      notify(ProgressStage.GENERATING_TASK, { transcript: transcriptText });

      const llmClientProvider = await LLMClientProvider.getInstanceAsync();
      if (!llmClientProvider) {
        throw new Error("LLM Client Provider is not initialized");
      }

      const userPrompt = `Process the following transcript into a structured JSON object:
      
      ${transcriptText}`;

      const intermediateOutput = await llmClientProvider.generateJson(
        userPrompt,
        INITIAL_SUMMARY_PROMPT,
      );

      notify(ProgressStage.EXECUTING_TASK, { transcriptText, intermediateOutput });

      const customPrompt = await this.customPromptStorage.getActivePrompt();
      const systemPrompt = buildTaskExecutionPrompt(customPrompt?.content);

      const orchestrator = await MCPOrchestrator.getInstanceAsync();
      const mcpResult = await orchestrator.manualLoopAsync(transcriptText, youtubeResult, {
        systemPrompt,
        videoFilePath: filePath,
      });

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
        }
      }

      let metadataUpdateError: string | undefined;

      if (youtubeResult.origin !== "external" && youtubeResult.success) {
        const videoId = youtubeResult.data?.videoId;
        if (videoId) {
          try {
            // throw new Error("Simulated metadata update error"); // TODO: Remove this line after testing error handling
            notify(ProgressStage.UPDATING_METADATA);
            const metadata = await this.metadataBuilder.build({
              transcriptVtt: transcript,
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
            } else {
              throw new Error(
                `[ProcessVideo] YouTube metadata update failed: ${updateResult.error || "Unknown error"}`,
              );
            }
          } catch (metadataError) {
            console.warn("Metadata update failed", metadataError);
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
