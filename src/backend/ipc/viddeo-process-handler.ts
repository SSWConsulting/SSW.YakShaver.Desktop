import fs from "fs"
import { BrowserWindow, ipcMain } from "electron";
import { IPC_CHANNELS } from "./channels";
import { YouTubeAuthService } from "../services/auth/youtube-auth";
import { FFmpegService } from "../services/ffmpeg/ffmpeg-service";
import { MCPOrchestrator } from "../services/mcp/mcp-orchestrator";
import { OpenAIService } from "../services/openai/openai-service";
import {
    INITIAL_SUMMARY_PROMPT,
    TASK_EXECUTION_PROMPT,
} from "../services/openai/prompts";
import tmp from "tmp";


export class VideoProcessIPCHandlers {
    private readonly youtube = YouTubeAuthService.getInstance();
    private readonly llmClient = OpenAIService.getInstance(); // TODO: make generic interface for different LLMs https://github.com/SSWConsulting/SSW.YakShaver/issues/3011
    private ffmpegService = FFmpegService.getInstance();
    private readonly mcpOrchestrator: MCPOrchestrator;

    constructor() {
        this.mcpOrchestrator = new MCPOrchestrator({}, this.llmClient)
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

            console.log("Starting video processing for file:", filePath);

            // upload to YouTube
            const youtubeResult = await this.youtube.uploadVideo(filePath);
            console.log("Uploaded video to YouTube:", youtubeResult);

            // convert video to mp3
            this.emitProgress("converting_audio");
            const mp3FilePath = await this.convertVideoToMp3(filePath);
            console.log("*******************************************************************************************************************")
            console.log("Converted video to mp3:", mp3FilePath);

            // transcribe the video via MCP
            this.emitProgress("transcribing");
            const transcript = await this.llmClient.transcribeAudio(mp3FilePath);
            this.emitProgress("generating_task", { transcript });
            console.log("*******************************************************************************************************************");
            console.log("Transcription completed: ", transcript);

            // generate intermediate summary
            const intermediateOutput = await this.llmClient.generateOutput(
                INITIAL_SUMMARY_PROMPT,
                transcript,
                { jsonMode: true },
            );
            this.emitProgress("executing_task", {
                transcript,
                intermediateOutput,
            });
            console.log("*******************************************************************************************************************");
            console.log("Generated intermediate summary: ", intermediateOutput);

            // process transcribtion with MCP
            const mcpResult = await this.mcpOrchestrator.processMessage(intermediateOutput, youtubeResult);
            this.emitProgress("completed", {
                transcript,
                intermediateOutput,
                mcpResult,
            });
            console.log("*******************************************************************************************************************");
            console.log("MCP processing completed: ", mcpResult);

            // delete the temporary video file
            fs.unlinkSync(filePath);

            return { youtubeResult, mcpResult };
        });
    }

    private async convertVideoToMp3(inputPath: string): Promise<string> {
        const outputFilePath = tmp.tmpNameSync({ postfix: ".mp3" });
        const result = await this.ffmpegService.ConvertVideoToMp3(
            inputPath,
            outputFilePath,
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