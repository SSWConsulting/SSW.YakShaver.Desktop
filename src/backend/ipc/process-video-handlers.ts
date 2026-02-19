import fs from "node:fs";
import { BrowserWindow, type IpcMainInvokeEvent, ipcMain } from "electron";
import tmp from "tmp";
import { z } from "zod";
import { ProgressStage as WorkflowProgressStage } from "../../shared/types/workflow";
import { INITIAL_SUMMARY_PROMPT } from "../constants/prompts";
import { MicrosoftAuthService } from "../services/auth/microsoft-auth";
import type { VideoUploadResult } from "../services/auth/types";
import { YouTubeClient } from "../services/auth/youtube-client";
import { FFmpegService } from "../services/ffmpeg/ffmpeg-service";
import { LanguageModelProvider } from "../services/mcp/language-model-provider";
import { MCPOrchestrator } from "../services/mcp/mcp-orchestrator";
import { TranscriptionModelProvider } from "../services/mcp/transcription-model-provider";
import { SendWorkItemDetailsToPortal, WorkItemDtoSchema } from "../services/portal/actions";
import { ShaveService } from "../services/shave/shave-service";
import { CustomPromptStorage } from "../services/storage/custom-prompt-storage";
import { VideoMetadataBuilder } from "../services/video/video-metadata-builder";
import { YouTubeDownloadService } from "../services/video/youtube-service";
import { UserInteractionService } from "../services/user-interaction/user-interaction-service";
import { UserSettingsStorage } from "../services/storage/user-settings-storage";
import { McpWorkflowAdapter } from "../services/workflow/mcp-workflow-adapter";
import { WorkflowStateManager } from "../services/workflow/workflow-state-manager";
import { ProgressStage } from "../types";
import { formatErrorMessage } from "../utils/error-utils";
import { IPC_CHANNELS } from "./channels";
import { PromptManager, type PromptSummary } from "../services/prompt/prompt-manager";

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

interface ProjectSelectionResult {
  id: string;
  name: string;
  description?: string;
  source: "local" | "remote";
  reason: string; // The reasoning behind why this project was selected, for transparency
}

export class ProcessVideoIPCHandlers {
  private readonly youtube = YouTubeClient.getInstance();
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

          const languageModelProvider = await LanguageModelProvider.getInstance();
          const projectDetails = await this.getConfirmedProjectDetails(
            languageModelProvider,
            intermediateOutput,
          );

          const customPrompt = await this.customPromptStorage.getActivePrompt();
          // const systemPrompt = buildTaskExecutionPrompt(customPrompt?.content);
          const projectDetailPrompt = JSON.stringify(projectDetails);
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
              projectDetailPrompt,
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

  private async getConfirmedProjectDetails(
    languageModelProvider: LanguageModelProvider,
    transcriptText: string,
  ) {
    const promptManager = PromptManager.getInstance();
    const projectPrompts = await promptManager.getAllPrompts();
    let selectedProject = await this.selectProjectPrompt(
      languageModelProvider,
      projectPrompts,
      transcriptText,
    );

    // Confirm project selection with user if not in YOLO mode
    const userSettings = await UserSettingsStorage.getInstance().getSettingsAsync();
    const mode = userSettings?.toolApprovalMode || "ask";

    if (mode !== "yolo") {
      // In "wait" mode, auto-approve after 15 seconds
      const autoApproveAt = mode === "wait" ? Date.now() + 15000 : undefined;

      try {
        const userResponse = await UserInteractionService.getInstance().requestProjectSelection(
          {
            selectedProject: {
              id: selectedProject.id,
              name: selectedProject.name,
              description: selectedProject.description,
              reason: selectedProject.reason,
              source: selectedProject.source,
            },
            allProjects: projectPrompts.map((p) => ({
              id: p.id,
              name: p.name,
              description: p.description,
              source: p.source,
            })),
          },
          { autoApproveAt },
        );

        // Update selected project if user changed it
        if (userResponse.projectId !== selectedProject.id) {
          const newProject = projectPrompts.find((p) => p.id === userResponse.projectId);
          if (newProject) {
            selectedProject = {
              id: newProject.id,
              name: newProject.name,
              description: newProject.description,
              reason: "User manually selected this project.",
              source: newProject.source,
            };
            console.log("User changed project to:", selectedProject);
          }
        }
      } catch (error) {
        console.error("Project selection interaction failed or was cancelled:", error);
      }
    }

    const projectDetails = await promptManager.getProjectDetails(
      selectedProject.id,
      selectedProject.source,
    );

    return projectDetails;
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

      // Select project prompt based on transcript
      console.log("++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++");
      const projectDetails = await this.getConfirmedProjectDetails(
        languageModelProvider,
        transcriptText,
      );
      workflowManager.startStage(WorkflowProgressStage.EXECUTING_TASK);

      notify(ProgressStage.EXECUTING_TASK, { transcriptText, intermediateOutput });

      const customPrompt = await this.customPromptStorage.getActivePrompt();
      // const systemPrompt = buildTaskExecutionPrompt(customPrompt?.content);
      const projectDetailPrompt = JSON.stringify(projectDetails);
      const serverFilter = customPrompt?.selectedMcpServerIds;

      const mcpAdapter = new McpWorkflowAdapter(workflowManager, {
        transcriptText,
        intermediateOutput,
      });

      const orchestrator = await MCPOrchestrator.getInstanceAsync();
      const mcpResult = await orchestrator.manualLoopAsync(transcriptText, youtubeResult, {
        projectDetailPrompt,
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
        } else if (shaveId) {
          try {
            const shaveService = ShaveService.getInstance();
            shaveService.updateShave(shaveId, { portalWorkItemId: portalResult.workItemId });
          } catch (savePortalIdError) {
            console.warn("[ProcessVideo] Failed to persist portal work item id", savePortalIdError);
          }
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

  public async selectProjectPrompt(
    languageModelProvider: LanguageModelProvider,
    projectSummaries: PromptSummary[],
    videoTranscription: string,
  ): Promise<ProjectSelectionResult> {
    if (!projectSummaries.length) {
      console.warn("[MCPOrchestrator] No project prompts available for selection");
      return {
        id: "0000-0000-0000-0000",
        name: "N/A",
        description: "N/A",
        reason: "No project prompts available for selection",
        source: "local",
      };
    }

    if (!videoTranscription?.trim()) {
      console.warn("[MCPOrchestrator] Empty video transcription provided");
      return {
        id: "0000-0000-0000-0000",
        name: "N/A",
        description: "N/A",
        reason: "Empty video transcription provided",
        source: "local",
      };
    }

    const selectedProjectPromptSchema = z.object({
      id: z.string(),
      reason: z.string().describe("The reason why this project was selected"),
    });

    const projectsList = projectSummaries
      .map((p) => `- ID: ${p.id}\n  Name: ${p.name}\n  Description: ${p.description || "N/A"}`)
      .join("\n\n");

    const systemPrompt = `You are an AI assistant helping to select the most relevant project for a video transcription.
Your task is to analyze the user's video transcription and match it to one of the most relevant projects based on the project name and description.
If no project is a good match, try your best to provide a reason why".

format example:
{
  "id": "the id of the selected project, or '0000-0000-0000-0000' if no project is relevant",
  "reason": "a brief explanation of why this project was selected or why no project was selected"
}

Available Projects:
${projectsList}`;

    try {
      if (!languageModelProvider) {
        throw new Error("[process-video-handlers]: LLM client not initialized");
      }

      const result = await languageModelProvider.generateObject(
        `Please select the best matching project for this transcription:\n\n"${videoTranscription}"`,
        selectedProjectPromptSchema,
        systemPrompt,
      );

      if (result?.id) {
        // Validation: Ensure the selected project ID exists in the provided list
        const matchedProject = projectSummaries.find((p) => p.id === result.id);
        if (matchedProject) {
          return {
            id: matchedProject.id,
            name: matchedProject.name,
            description: matchedProject.description,
            reason: result.reason,
            source: matchedProject.source,
          };
        }
      }
      console.warn(`[process-video-handlers] LLM selected unknown project ID: ${result?.id}`);
      return {
        id: "0000-0000-0000-0000",
        name: "N/A",
        description: "N/A",
        reason: result?.reason || "Failed to select project prompt due to an error",
        source: "local",
      };
    } catch (error) {
      console.error("[process-video-handlers] Failed to select project prompt:", error);
      return {
        id: "0000-0000-0000-0000",
        name: "N/A",
        description: "N/A",
        reason: "Failed to select project prompt due to an error",
        source: "local",
      };
    }
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
}
