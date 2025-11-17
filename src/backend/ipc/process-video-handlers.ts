import fs from "node:fs";
import { BrowserWindow, type IpcMainInvokeEvent, ipcMain } from "electron";
import tmp from "tmp";
import type { VideoUploadResult } from "../services/auth/types";
import { YouTubeAuthService } from "../services/auth/youtube-auth";
import { FFmpegService } from "../services/ffmpeg/ffmpeg-service";
import { MCPOrchestrator } from "../services/mcp/mcp-orchestrator";
import { OpenAIService } from "../services/openai/openai-service";
import { buildTaskExecutionPrompt, INITIAL_SUMMARY_PROMPT } from "../services/openai/prompts";
import { CustomPromptStorage } from "../services/storage/custom-prompt-storage";
import { YouTubeDownloadService } from "../services/youtube/youtube-download-service";
import { ProgressStage } from "../types";
import { formatErrorMessage } from "../utils/error-utils";
import { IPC_CHANNELS } from "./channels";

type ProcessVideoPayload = {
  filePath?: string;
  youtubeUrl?: string;
};

export class ProcessVideoIPCHandlers {
  private readonly youtube = YouTubeAuthService.getInstance();
  private readonly llmClient = OpenAIService.getInstance(); // TODO: make generic interface for different LLMs https://github.com/SSWConsulting/SSW.YakShaver/issues/3011
  private ffmpegService = FFmpegService.getInstance();
  private readonly youtubeDownloader = YouTubeDownloadService.getInstance();
  private readonly mcpOrchestrator: MCPOrchestrator;
  private readonly customPromptStorage = CustomPromptStorage.getInstance();

  constructor() {
    this.mcpOrchestrator = new MCPOrchestrator({}, this.llmClient);
    this.registerHandlers();
  }

  private registerHandlers(): void {
    ipcMain.handle(
      IPC_CHANNELS.PROCESS_VIDEO,
      async (_event, payload?: string | ProcessVideoPayload) => {
        let filePath: string | undefined;
        if (typeof payload === "string" || payload === undefined) {
          filePath = payload;
        } else if (typeof payload === "object" && payload !== null) {
          filePath = payload.filePath;
        }

        const youtubeUrl =
          typeof payload === "object" && payload !== null ? payload.youtubeUrl : undefined;

        let cleanupPath: string | null = null;

        if (youtubeUrl) {
          this.emitProgress(ProgressStage.DOWNLOADING_SOURCE, { youtubeUrl });
          filePath = await this.youtubeDownloader.downloadVideo(youtubeUrl);
          cleanupPath = filePath;
        }

        if (!filePath) {
          throw new Error("video-process-handler: Video file path is required");
        }

        if (!fs.existsSync(filePath)) {
          throw new Error("video-process-handler: Video file does not exist");
        }

        let fileRemoved = false;

        try {
          const isExistingYoutubeVideo = Boolean(youtubeUrl);
          const youtubeResult = isExistingYoutubeVideo
            ? await this.buildExistingVideoResult(youtubeUrl!)
            : await this.youtube.uploadVideo(filePath);

          this.emitProgress(ProgressStage.UPLOAD_COMPLETED, { uploadResult: youtubeResult });

          // convert video to mp3
          this.emitProgress(ProgressStage.CONVERTING_AUDIO);
          const mp3FilePath = await this.convertVideoToMp3(filePath);

          // transcribe the video via MCP
          this.emitProgress(ProgressStage.TRANSCRIBING);
          const transcript = await this.llmClient.transcribeAudio(mp3FilePath);
          this.emitProgress(ProgressStage.TRANSCRIPTION_COMPLETED, { transcript });

          this.emitProgress(ProgressStage.GENERATING_TASK, { transcript });

          // generate intermediate summary
          const intermediateOutput = await this.llmClient.generateOutput(
            INITIAL_SUMMARY_PROMPT,
            transcript,
            { jsonMode: true },
          );
          this.emitProgress(ProgressStage.EXECUTING_TASK, {
            transcript,
            intermediateOutput,
          });

          // process transcription with MCP
          const customPrompt = await this.customPromptStorage.getActivePrompt();
          const systemPrompt = buildTaskExecutionPrompt(customPrompt?.content);

          const mcpResult = await this.mcpOrchestrator.processMessage(
            intermediateOutput,
            youtubeResult,
            { systemPrompt },
          );

          this.emitProgress(ProgressStage.COMPLETED, {
            transcript,
            intermediateOutput,
            mcpResult,
            finalOutput: mcpResult.final,
          });

          // delete the temporary video file
          fs.unlinkSync(filePath);
          fileRemoved = true;

          return { youtubeResult, mcpResult };
        } finally {
          if (!fileRemoved && cleanupPath && fs.existsSync(cleanupPath)) {
            try {
              fs.unlinkSync(cleanupPath);
            } catch {
              // ignore cleanup errors
            }
          }
        }
      },
    );

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

          const mcpResult = await this.mcpOrchestrator.processMessage(
            intermediateOutput,
            videoUploadResult,
            { systemPrompt },
          );

          this.emitProgress(ProgressStage.COMPLETED, {
            mcpResult,
            finalOutput: mcpResult.final,
          });
          return { success: true, mcpResult };
        } catch (error) {
          const errorMessage = formatErrorMessage(error);
          this.emitProgress(ProgressStage.ERROR, { error: errorMessage });
          return { success: false, error: errorMessage };
        }
      },
    );
  }

  private async convertVideoToMp3(inputPath: string): Promise<string> {
    const outputFilePath = tmp.tmpNameSync({ postfix: ".mp3" });
    const result = await this.ffmpegService.ConvertVideoToMp3(inputPath, outputFilePath);
    return result;
  }

  private async buildExistingVideoResult(youtubeUrl: string): Promise<VideoUploadResult> {
    const metadata = await this.youtubeDownloader.fetchVideoMetadata(youtubeUrl);
    const fallbackTitle = "Existing YouTube video";

    return {
      success: true,
      data: {
        title: metadata?.title ?? fallbackTitle,
        description:
          metadata?.description ??
          (metadata?.title
            ? `Processing existing video "${metadata.title}"`
            : "Processing the provided YouTube video"),
        url: metadata?.url ?? youtubeUrl,
      },
    };
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
