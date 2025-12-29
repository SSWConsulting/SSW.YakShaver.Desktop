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
    ipcMain.handle(IPC_CHANNELS.PROCESS_VIDEO_FILE, async (_event, filePath?: string) => {
      if (!filePath) {
        throw new Error("video-process-handler: Video file path is required");
      }

      return await this.processFileVideo(filePath);
    });

    ipcMain.handle(IPC_CHANNELS.PROCESS_VIDEO_URL, async (_event, url?: string) => {
      if (!url) {
        throw new Error("video-process-handler: Video URL is required");
      }

      return await this.processUrlVideo(url);
    });

    // Retry video pipeline
    ipcMain.handle(
      IPC_CHANNELS.RETRY_VIDEO,
      async (
        _event: IpcMainInvokeEvent,
        intermediateOutput: string,
        videoUploadResult: VideoUploadResult,
      ) => {
        try {
          this.emitProgress(ProgressStage.EXECUTING_TASK);

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

          this.emitProgress(ProgressStage.COMPLETED, {
            mcpResult,
            finalOutput: mcpResult,
          });
          return { success: true, finalOutput: mcpResult };
        } catch (error) {
          const errorMessage = formatErrorMessage(error);
          this.emitProgress(ProgressStage.ERROR, { error: errorMessage });
          return { success: false, error: errorMessage };
        }
      },
    );
  }

  private async processFileVideo(filePath: string) {
    // check file exists
    if (!fs.existsSync(filePath)) {
      throw new Error("video-process-handler: Video file does not exist");
    }

    // upload to YouTube
    this.emitProgress(ProgressStage.UPLOADING_SOURCE, {
      sourceOrigin: "upload",
    });
    const youtubeResult = await this.youtube.uploadVideo(filePath);
    this.emitProgress(ProgressStage.UPLOAD_COMPLETED, {
      uploadResult: youtubeResult,
      sourceOrigin: youtubeResult.origin,
    });

    return await this.processVideoSource({
      filePath,
      youtubeResult,
    });
  }

  private async processUrlVideo(url: string) {
    try {
      const youtubeResult = await this.youtubeDownloadService.getVideoMetadata(url);
      this.emitProgress(ProgressStage.UPLOAD_COMPLETED, {
        uploadResult: youtubeResult,
        sourceOrigin: "external",
      });
      this.emitProgress(ProgressStage.DOWNLOADING_SOURCE, {
        sourceOrigin: "external",
      });
      const filePath = await this.youtubeDownloadService.downloadVideoToFile(url);
      return await this.processVideoSource({
        filePath,
        youtubeResult,
      });
    } catch (error) {
      const errorMessage = formatErrorMessage(error);
      this.emitProgress(ProgressStage.ERROR, { error: errorMessage });
      return { success: false, error: errorMessage };
    }
  }

  private async processVideoSource({ filePath, youtubeResult }: VideoProcessingContext) {
    // check file exists
    if (!fs.existsSync(filePath)) {
      throw new Error("video-process-handler: Video file does not exist");
    }

    try {
      this.lastVideoFilePath = filePath;
      this.emitProgress(ProgressStage.CONVERTING_AUDIO);
      const mp3FilePath = await this.convertVideoToMp3(filePath);

      this.emitProgress(ProgressStage.TRANSCRIBING);
      let transcript = await this.llmClient.transcribeAudio(mp3FilePath);
      this.emitProgress(ProgressStage.TRANSCRIPTION_COMPLETED, { transcript });

      transcript = parseVtt(transcript)
        .map((segment: TranscriptSegment) => segment.text)
        .join(" ");

      this.emitProgress(ProgressStage.GENERATING_TASK, { transcript });

      const llmClientProvider = await LLMClientProvider.getInstanceAsync();
      if (!llmClientProvider) {
        throw new Error("LLM Client Provider is not initialized");
      }

      const intermediateOutput = await llmClientProvider.generateJson(INITIAL_SUMMARY_PROMPT);

      this.emitProgress(ProgressStage.EXECUTING_TASK, {
        transcript,
        intermediateOutput: intermediateOutput,
      });

      const customPrompt = await this.customPromptStorage.getActivePrompt();
      const systemPrompt = buildTaskExecutionPrompt(customPrompt?.content);

      const orchestrator = await MCPOrchestrator.getInstanceAsync();
      const mcpResult = await orchestrator.manualLoopAsync(transcript, youtubeResult, {
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
          this.emitProgress(ProgressStage.ERROR, { error: errorMessage });
        }
      }

      if (youtubeResult.origin !== "external" && youtubeResult.success) {
        const videoId = youtubeResult.data?.videoId;
        if (videoId) {
          try {
            this.emitProgress(ProgressStage.UPDATING_METADATA);
            const metadata = await this.metadataBuilder.build({
              transcriptVtt: transcript,
              executionHistory: JSON.stringify(transcript ?? [], null, 2),
              finalResult: mcpResult ?? undefined,
            });
            this.emitProgress(ProgressStage.UPDATING_METADATA, {
              metadataPreview: metadata.metadata,
            });
            const updateResult = await this.youtube.updateVideoMetadata(
              videoId,
              metadata.snippet,
              youtubeResult.origin,
            );
            if (updateResult.success) {
              youtubeResult = updateResult;
            } else if (updateResult.error) {
              console.warn("[ProcessVideo] YouTube metadata update failed:", updateResult.error);
            }
          } catch (metadataError) {
            console.warn("[ProcessVideo] Failed to update YouTube metadata", metadataError);
          }
        }
      }

      this.emitProgress(ProgressStage.COMPLETED, {
        transcript,
        intermediateOutput,
        mcpResult,
        finalOutput: mcpResult,
        uploadResult: youtubeResult,
      });

      return { youtubeResult, mcpResult };
    } catch (error) {
      const errorMessage = formatErrorMessage(error);
      this.emitProgress(ProgressStage.ERROR, { error: errorMessage });
      return { success: false, error: errorMessage };
    }
  }

  private async convertVideoToMp3(inputPath: string): Promise<string> {
    const outputFilePath = tmp.tmpNameSync({ postfix: ".mp3" });
    const result = await this.ffmpegService.ConvertVideoToMp3(inputPath, outputFilePath);
    return result;
  }

  private emitProgress(stage: string, data?: Record<string, unknown>) {
    BrowserWindow.getAllWindows()
      .filter((win) => !win.isDestroyed())
      .forEach((win) => {
        win.webContents.send(IPC_CHANNELS.WORKFLOW_PROGRESS, {
          stage,
          ...data,
        });
      });
  }
}
