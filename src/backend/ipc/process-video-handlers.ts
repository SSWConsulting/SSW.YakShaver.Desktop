import fs from "node:fs";
import { BrowserWindow, type IpcMainInvokeEvent, ipcMain } from "electron";
import tmp from "tmp";
import type { VideoUploadResult } from "../services/auth/types";
import { YouTubeAuthService } from "../services/auth/youtube-auth";
import { FFmpegService } from "../services/ffmpeg/ffmpeg-service";
import { OpenAIService } from "../services/openai/openai-service";
import { buildTaskExecutionPrompt, INITIAL_SUMMARY_PROMPT } from "../services/openai/prompts";
import { CustomPromptStorage } from "../services/storage/custom-prompt-storage";
import { ProgressStage } from "../types";
import { formatErrorMessage } from "../utils/error-utils";
import { IPC_CHANNELS } from "./channels";
import { MCPOrchestratorNeo } from "../services/mcp/mcp-orchestrator-neo";

export class ProcessVideoIPCHandlers {
  private readonly youtube = YouTubeAuthService.getInstance();
  private readonly llmClient = OpenAIService.getInstance(); // TODO: make generic interface for different LLMs https://github.com/SSWConsulting/SSW.YakShaver/issues/3011
  private ffmpegService = FFmpegService.getInstance();
  private readonly customPromptStorage = CustomPromptStorage.getInstance();

  constructor() {
    this.registerHandlers();
  }

  private registerHandlers(): void {
    ipcMain.handle(IPC_CHANNELS.PROCESS_VIDEO, async (event, filePath?: string) => {
      if (!filePath) {
        throw new Error("video-process-handler: Video file path is required");
      }

      // check file exists
      if (!fs.existsSync(filePath)) {
        throw new Error("video-process-handler: Video file does not exist");
      }

      // upload to YouTube
      // const youtubeResult = await this.youtube.uploadVideo(filePath);
      const youtubeResult: VideoUploadResult = {
        success: true,
        data: {
          title: "",
          description: "",
          url: "",
        },
      };
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

      const orchestrator = await MCPOrchestratorNeo.getInstanceAsync();
      const mcpResult = await orchestrator.processMessageAsync(intermediateOutput, youtubeResult, {
        systemPrompt,
      });

      this.emitProgress(ProgressStage.COMPLETED, {
        transcript,
        intermediateOutput,
        mcpResult,
        finalOutput: mcpResult,
      });

      // delete the temporary video file
      fs.unlinkSync(filePath);

      return { youtubeResult, mcpResult };
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

          const orchestrator = await MCPOrchestratorNeo.getInstanceAsync();
          const mcpResult = await orchestrator.processMessageAsync(
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
