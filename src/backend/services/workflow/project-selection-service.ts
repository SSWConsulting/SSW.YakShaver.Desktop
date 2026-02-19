import type { LanguageModelProvider } from "../mcp/language-model-provider";
import { PromptManager, type PromptSummary } from "../prompt/prompt-manager";
import { UserInteractionService } from "../user-interaction/user-interaction-service";
import { UserSettingsStorage } from "../storage/user-settings-storage";
import { z } from "zod";

export interface ProjectSelectionResult {
  id: string;
  name: string;
  description?: string;
  source: "local" | "remote";
  reason: string;
}

export class ProjectSelectionService {
  private static instance: ProjectSelectionService;

  private constructor() {}

  public static getInstance(): ProjectSelectionService {
    if (!ProjectSelectionService.instance) {
      ProjectSelectionService.instance = new ProjectSelectionService();
    }
    return ProjectSelectionService.instance;
  }

  public async getConfirmedProjectDetails(
    languageModelProvider: LanguageModelProvider,
    transcriptText: string,
  ) {
    const promptManager = PromptManager.getInstance();
    const projectPrompts = await promptManager.getAllPrompts();

    // Use LLM to select the most relevant project based on video transcription
    let selectedProject = await this.selectProjectPrompt(
      languageModelProvider,
      projectPrompts,
      transcriptText,
    );

    // Confirm project selection with user if not in YOLO mode
    selectedProject = await this.confirmSelectionWithUser(selectedProject, projectPrompts);

    const projectDetails = await promptManager.getProjectDetails(
      selectedProject.id,
      selectedProject.source,
    );

    if (projectDetails) {
      return {
        ...projectDetails,
        selectionReason: selectedProject.reason,
      };
    }

    return projectDetails;
  }

  private async confirmSelectionWithUser(
    selectedProject: ProjectSelectionResult,
    allProjects: PromptSummary[],
  ): Promise<ProjectSelectionResult> {
    const userSettings = await UserSettingsStorage.getInstance().getSettingsAsync();
    const mode = userSettings?.toolApprovalMode || "ask";

    if (mode === "yolo") {
      return selectedProject;
    }

    // In "wait" mode, auto-approve after 15 seconds
    const autoApproveAt = mode === "wait" ? Date.now() + 15000 : undefined;

    try {
      // Send project selection to user for confirmation, allowing them to change the selection if they want
      const userResponse = await UserInteractionService.getInstance().requestProjectSelection(
        {
          selectedProject: {
            id: selectedProject.id,
            name: selectedProject.name,
            description: selectedProject.description,
            reason: selectedProject.reason,
            source: selectedProject.source,
          },
          allProjects: allProjects.map((p) => ({
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
        const newProject = allProjects.find((p) => p.id === userResponse.projectId);
        if (newProject) {
          const updatedProject = {
            id: newProject.id,
            name: newProject.name,
            description: newProject.description,
            reason: "User manually selected this project.",
            source: newProject.source,
          };
          console.log("User changed project to:", updatedProject);
          return updatedProject;
        }
      }
    } catch (error) {
      console.error("Project selection interaction failed or was cancelled:", error);
    }

    return selectedProject;
  }

  public async selectProjectPrompt(
    languageModelProvider: LanguageModelProvider,
    projectSummaries: PromptSummary[],
    videoTranscription: string,
  ): Promise<ProjectSelectionResult> {
    const errorResult = await this.validateSelectProjectInputs(
      projectSummaries,
      videoTranscription,
    );
    if (errorResult) {
      return errorResult;
    }

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
        throw new Error("[ProjectSelectionService]: LLM client not initialized");
      }

      const selectedProjectPromptSchema = z.object({
        id: z.string(),
        reason: z.string().describe("The reason why this project was selected"),
      });

      const result = await languageModelProvider.generateObject(
        `Please select the best matching project for this transcription:\n\n"${videoTranscription}"`,
        selectedProjectPromptSchema,
        systemPrompt,
      );

      return this.mapLlmResultToProject(result, projectSummaries);
    } catch (error) {
      console.error("[ProjectSelectionService] Failed to select project prompt:", error);
      return this.createErrorResult("Failed to select project prompt due to an error");
    }
  }

  private async validateSelectProjectInputs(
    projectSummaries: PromptSummary[],
    videoTranscription: string,
  ): Promise<ProjectSelectionResult | null> {
    if (!projectSummaries.length) {
      console.warn("[ProjectSelectionService] No project prompts available for selection");
      return this.createErrorResult("No project prompts available for selection");
    }

    if (!videoTranscription?.trim()) {
      console.warn("[ProjectSelectionService] Empty video transcription provided");
      return this.createErrorResult("Empty video transcription provided");
    }
    return null;
  }

  private mapLlmResultToProject(
    result: { id?: string; reason?: string } | undefined,
    projectSummaries: PromptSummary[],
  ): ProjectSelectionResult {
    if (result?.id) {
      const matchedProject = projectSummaries.find((p) => p.id === result.id);
      if (matchedProject) {
        return {
          id: matchedProject.id,
          name: matchedProject.name,
          description: matchedProject.description,
          reason: result.reason || "Project selected by AI",
          source: matchedProject.source,
        };
      }
    }

    console.warn(`[ProjectSelectionService] LLM selected unknown project ID: ${result?.id}`);
    return this.createErrorResult(
      result?.reason || "Failed to select project prompt due to an error",
    );
  }

  private createErrorResult(reason: string): ProjectSelectionResult {
    return {
      id: "0000-0000-0000-0000",
      name: "N/A",
      description: "N/A",
      reason,
      source: "local",
    };
  }
}
