import fs from "node:fs";
import { BrowserWindow, type IpcMainInvokeEvent, ipcMain } from "electron";
import tmp from "tmp";
import type { VideoUploadResult } from "../services/auth/types";
import { YouTubeAuthService } from "../services/auth/youtube-auth";
import { FFmpegService } from "../services/ffmpeg/ffmpeg-service";
import { MCPOrchestrator } from "../services/mcp/mcp-orchestrator";
import { OpenAIService } from "../services/openai/openai-service";
import {
  buildTaskExecutionPrompt,
  INITIAL_SUMMARY_PROMPT,
} from "../services/openai/prompts";
import { SettingsStore } from "../services/storage/settings-store";
import { formatErrorMessage } from "../utils/error-utils";
import { IPC_CHANNELS } from "./channels";

export class ProcessVideoIPCHandlers {
  private readonly youtube = YouTubeAuthService.getInstance();
  private readonly llmClient = OpenAIService.getInstance(); // TODO: make generic interface for different LLMs https://github.com/SSWConsulting/SSW.YakShaver/issues/3011
  private ffmpegService = FFmpegService.getInstance();
  private readonly mcpOrchestrator: MCPOrchestrator;
  private readonly settingsStore = SettingsStore.getInstance();

  constructor() {
    this.mcpOrchestrator = new MCPOrchestrator({}, this.llmClient);
    this.registerHandlers();
  }

  private registerHandlers(): void {
    ipcMain.handle(
      IPC_CHANNELS.PROCESS_VIDEO,
      async (event, filePath?: string) => {
        if (!filePath) {
          throw new Error("video-process-handler: Video file path is required");
        }

        // check file exists
        if (!fs.existsSync(filePath)) {
          throw new Error("video-process-handler: Video file does not exist");
        }

        // upload to YouTube
        const youtubeResult = await this.youtube.uploadVideo(filePath);
        this.emitProgress("upload_completed", { uploadResult: youtubeResult });

        // convert video to mp3
        this.emitProgress("converting_audio");
        const mp3FilePath = await this.convertVideoToMp3(filePath);

        // transcribe the video via MCP
        this.emitProgress("transcribing");
        const transcript = await this.llmClient.transcribeAudio(mp3FilePath);
        this.emitProgress("transcription_completed", { transcript });

        this.emitProgress("generating_task", { transcript });

        // generate intermediate summary
        const intermediateOutput = await this.llmClient.generateOutput(
          INITIAL_SUMMARY_PROMPT,
          transcript,
          { jsonMode: true }
        );
        this.emitProgress("executing_task", {
          transcript,
          intermediateOutput,
        });

        // process transcription with MCP
        const customPrompt = this.settingsStore.getCustomPrompt();
        const systemPrompt = buildTaskExecutionPrompt(customPrompt);

        const mcpResult = await this.mcpOrchestrator.processMessage(
          intermediateOutput,
          youtubeResult,
          { systemPrompt }
        );

        this.emitProgress("completed", {
          transcript,
          intermediateOutput,
          mcpResult,
          finalOutput: mcpResult.final,
        });

        // delete the temporary video file
        fs.unlinkSync(filePath);

        return { youtubeResult, mcpResult };
      }
    );

    // Retry video pipeline
    ipcMain.handle(
      IPC_CHANNELS.RETRY_VIDEO,
      async (
        _event: IpcMainInvokeEvent,
        intermediateOutput: string,
        videoUploadResult: VideoUploadResult
      ) => {
        try {
          this.emitProgress("executing_task");

          const customPrompt = this.settingsStore.getCustomPrompt();
          const systemPrompt = buildTaskExecutionPrompt(customPrompt);

          const mcpResult = await this.mcpOrchestrator.processMessage(
            intermediateOutput,
            videoUploadResult,
            { systemPrompt }
          );

          this.emitProgress("completed", {
            mcpResult,
            finalOutput: mcpResult.final,
          });
          return { success: true, mcpResult };
        } catch (error) {
          const errorMessage = formatErrorMessage(error);
          this.emitProgress("error", { error: errorMessage });
          return { success: false, error: errorMessage };
        }
      }
    );
  }

  private async convertVideoToMp3(inputPath: string): Promise<string> {
    const outputFilePath = tmp.tmpNameSync({ postfix: ".mp3" });
    const result = await this.ffmpegService.ConvertVideoToMp3(
      inputPath,
      outputFilePath
    );
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
