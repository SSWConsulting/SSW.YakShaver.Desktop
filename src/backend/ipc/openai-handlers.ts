import * as fs from "node:fs";
import { BrowserWindow, type IpcMainInvokeEvent, ipcMain } from "electron";
import tmp from "tmp";
import type { VideoUploadResult } from "../services/auth/types";
import { FFmpegService } from "../services/ffmpeg/ffmpeg-service";
import { MCPOrchestrator } from "../services/mcp/mcp-orchestrator";
import { OpenAIService } from "../services/openai/openai-service";
import {
  INITIAL_SUMMARY_PROMPT,
  TASK_EXECUTION_PROMPT,
} from "../services/openai/prompts";
import { RecordingService } from "../services/recording/recording-service";
import { type LLMConfig, LlmStorage } from "../services/storage/llm-storage";
import { formatErrorMessage } from "../utils/error-utils";
import { IPC_CHANNELS } from "./channels";

export class OpenAIIPCHandlers {
  private openAiService = OpenAIService.getInstance();
  private recordingService = RecordingService.getInstance();
  private ffmpegService = FFmpegService.getInstance();
  private secureStorage = LlmStorage.getInstance();
  private mcpOrchestrator: MCPOrchestrator;

  constructor() {
    this.mcpOrchestrator = new MCPOrchestrator(
      { eagerCreate: true },
      this.openAiService
    );
    this.registerHandlers();
    this.setupListeners();
    void this.bootstrapStoredKey();
  }

  private async bootstrapStoredKey() {
    try {
      const llmCfg = await this.secureStorage.getLLMConfig();
      if (llmCfg) {
        if (llmCfg.provider === "openai") {
          this.openAiService.setOpenAIKey(llmCfg.apiKey);
        } else {
          this.openAiService.setAzureConfig(
            llmCfg.apiKey,
            llmCfg.endpoint,
            llmCfg.version,
            llmCfg.deployment
          );
        }
        return;
      }
    } catch (e) {
      throw new Error("Failed to bootstrap stored OpenAI key");
    }
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

  private async cleanupTempFiles(...files: string[]): Promise<void> {
    await Promise.all(
      files.map((file) =>
        fs.promises.unlink(file).catch((err) => {
          console.error(`Failed to delete ${file}: ${err}`);
        })
      )
    );
  }

  private async executeGeneratedTaskViaMCP(
    intermediateOutput: string,
    videoUploadResult: VideoUploadResult
  ): Promise<string | null> {
    const result = await this.mcpOrchestrator.processMessage(
      intermediateOutput,
      videoUploadResult,
      {
        systemPrompt: TASK_EXECUTION_PROMPT,
      }
    );
    return result.final;
  }

  private setupListeners(): void {
    this.recordingService.on(
      "recording-saved",
      async (inputFilePath: string, videoUploadResult: VideoUploadResult) => {
        if (!inputFilePath) {
          this.emitProgress("error", { error: "Invalid file path" });
          return;
        }

        const outputFilePath = tmp.tmpNameSync({ postfix: ".mp3" });

        try {
          this.emitProgress("converting_audio");
          await this.ffmpegService.ConvertVideoToMp3(
            inputFilePath,
            outputFilePath
          );

          this.emitProgress("transcribing");
          const transcript =
            await this.openAiService.transcribeAudio(outputFilePath);

          this.emitProgress("generating_task", { transcript });
          const intermediateOutput = await this.openAiService.generateOutput(
            INITIAL_SUMMARY_PROMPT,
            transcript,
            { jsonMode: true }
          );

          this.emitProgress("executing_task", {
            transcript,
            intermediateOutput,
          });
          const finalOutput = await this.executeGeneratedTaskViaMCP(
            intermediateOutput,
            videoUploadResult
          );

          this.emitProgress("completed", {
            transcript,
            intermediateOutput,
            finalOutput,
          });
        } catch (error) {
          this.emitProgress("error", { error: formatErrorMessage(error) });
        } finally {
          await this.cleanupTempFiles(inputFilePath, outputFilePath);
        }
      }
    );
  }

  private registerHandlers(): void {
    ipcMain.handle(
      IPC_CHANNELS.OPENAI_GET_TRANSCRIPTION,
      async (_event: IpcMainInvokeEvent, filePath: string) => {
        const transcript = await this.openAiService.transcribeAudio(filePath);
        return transcript;
      }
    );

    ipcMain.handle(
      IPC_CHANNELS.OPENAI_PROCESS_TRANSCRIPT,
      async (_event: IpcMainInvokeEvent, transcript: string) => {
        return await this.openAiService.generateOutput(
          INITIAL_SUMMARY_PROMPT,
          transcript,
          {
            jsonMode: true,
          }
        );
      }
    );

    ipcMain.handle(
      IPC_CHANNELS.WORKFLOW_RETRY_TASK_EXECUTION,
      async (
        _event: IpcMainInvokeEvent,
        intermediateOutput: string,
        videoUploadResult: VideoUploadResult
      ) => {
        try {
          this.emitProgress("executing_task");
          const finalOutput = await this.executeGeneratedTaskViaMCP(
            intermediateOutput,
            videoUploadResult
          );
          this.emitProgress("completed", { finalOutput });
          return { success: true, finalOutput };
        } catch (error) {
          const errorMessage = formatErrorMessage(error);
          this.emitProgress("error", { error: errorMessage });
          return { success: false, error: errorMessage };
        }
      }
    );

    ipcMain.handle(
      IPC_CHANNELS.LLM_SET_CONFIG,
      async (_event: IpcMainInvokeEvent, config: LLMConfig) => {
        if (!config || !("provider" in config))
          throw new Error("Invalid LLM config");
        await this.secureStorage.storeLLMConfig(config);
        // Reconfigure services
        if (config.provider === "openai") {
          this.openAiService.setOpenAIKey(config.apiKey);
        } else {
          this.openAiService.setAzureConfig(
            config.apiKey,
            config.endpoint,
            config.version,
            config.deployment
          );
        }
        return { success: true };
      }
    );

    ipcMain.handle(IPC_CHANNELS.LLM_GET_CONFIG, async () => {
      const cfg = await this.secureStorage.getLLMConfig();
      return cfg;
    });

    ipcMain.handle(IPC_CHANNELS.LLM_CLEAR_CONFIG, async () => {
      await this.secureStorage.clearLLMConfig();
      this.openAiService.clearOpenAIClient();
      return { success: true };
    });

    ipcMain.handle(IPC_CHANNELS.LLM_CHECK_HEALTH, async () => {
      return await this.openAiService.checkHealth();
    });
  }
}
