import https from "node:https";
import { config } from "../../config/env";
import { formatErrorMessage } from "../../utils/error-utils";
import { IdentityServerAuthService } from "../auth/identity-server-auth";
import { fetchProjectSummaries, type ProjectSummaryDto } from "../portal/portal-projects";
import { CustomPromptStorage } from "../storage/custom-prompt-storage";

// Define the Prompt interface that consolidates local and remote prompts
export interface PromptSummary {
  id: string;
  name: string;
  description?: string;
  source: "local" | "remote";
}

// Define the ProjectDto interface based on the C# class
export interface ProjectDto {
  id: string;
  name: string;
  description?: string;
  backlogUrl?: string;
  primaryContact?: unknown; // Defined as unknown until UserDto is needed
  members: unknown[]; // Defined as unknown[] until UserDto is needed
  videoHostType: string;
  recentWorkItemsCount: number;
  repoId?: string;
  allowWebhooks: boolean;
  allowCreatePbi: boolean;
  gitHubProjectId?: string;
  placeItemOnTopOfProductBacklog: boolean;
  desktopAgentProjectPrompt?: string;
  selectedMcpServerIds?: string[];
}

export class PromptManager {
  private static instance: PromptManager;
  private identityServerAuthService: IdentityServerAuthService;

  private constructor() {
    this.identityServerAuthService = IdentityServerAuthService.getInstance();
  }

  public static getInstance(): PromptManager {
    if (!PromptManager.instance) {
      PromptManager.instance = new PromptManager();
    }
    return PromptManager.instance;
  }

  /**
   * Fetches all prompts from local storage and remote API.
   * Returns a unified list of prompts.
   */
  async getAllPrompts(): Promise<PromptSummary[]> {
    const [localPrompts, remotePrompts] = await Promise.all([
      this.getLocalPrompts(),
      this.getRemotePrompts(),
    ]);

    // Combine local and remote prompts
    return [...localPrompts, ...remotePrompts];
  }

  /**
   * Retrieves prompts stored in the local SQLite database.
   */
  async getLocalPrompts(): Promise<PromptSummary[]> {
    try {
      const customPromptStorage = CustomPromptStorage.getInstance();
      const localData = await customPromptStorage.getAllPrompts();

      return localData.map((p) => ({
        id: p.id,
        name: p.name,
        description: p.description,
        source: "local" as const,
      }));
    } catch (error) {
      console.error("Failed to fetch local prompts:", error);
      return []; // Return empty array on failure to allow partial results
    }
  }

  /**
   * Retrieves prompts from the remote API.
   * Endpoint: api.yakshaver.ai/api/projects/summaries
   * If user is not authenticated, returns an empty array.
   */
  async getRemotePrompts(): Promise<PromptSummary[]> {
    try {
      if (!(await this.identityServerAuthService.isAuthenticated())) {
        return [];
      }

      const accessToken = await this.identityServerAuthService.getAccessToken();

      if (!accessToken) {
        console.warn("No access token available for remote prompts.");
        return [];
      }

      // Shared portal-projects fetch — single owner of the /projects/summaries contract.
      const parsed = await fetchProjectSummaries(accessToken);
      // This consumer treats an unexpected body as "no remote prompts" rather than an error.
      const data: ProjectSummaryDto[] = Array.isArray(parsed)
        ? (parsed as ProjectSummaryDto[])
        : [];

      // Map remote data to Prompt interface
      return data.map((item: ProjectSummaryDto) => ({
        id: item.id,
        name: item.title,
        description: item.description,
        source: "remote" as const,
      }));
    } catch (error) {
      console.error("Failed to fetch remote prompts:", error);
      return []; // Return empty array on failure
    }
  }

  async getProjectDetails(id: string, source?: "local" | "remote"): Promise<ProjectDto | null> {
    // If source is known to be local, or not specified but ID looks like a local one (optional heuristic)
    if (source === "local") {
      const customPromptStorage = CustomPromptStorage.getInstance();
      const localPrompt = await customPromptStorage.getPromptById(id);

      if (!localPrompt) return null;

      // Map local prompt to ProjectDto
      // Most fields will be default/null for local prompts as they are just simple prompts
      return {
        id: localPrompt.id,
        name: localPrompt.name,
        description: localPrompt.description,
        // Map local prompt content to desktopAgentProjectPrompt
        desktopAgentProjectPrompt: localPrompt.content,
        selectedMcpServerIds: localPrompt.selectedMcpServerIds,
        // Set defaults for other required fields
        videoHostType: "SharePoint", // Default
        recentWorkItemsCount: 0,
        allowWebhooks: false,
        allowCreatePbi: true, // Assuming local prompts allow creation
        placeItemOnTopOfProductBacklog: false,
        members: [],
      };
    }

    try {
      const accessToken = await this.identityServerAuthService.getAccessToken();
      if (!accessToken) {
        throw new Error("No access token available for fetching project details.");
      }

      const apiUrl = config.portalApiUrl();
      const url = new URL(apiUrl);
      const hostname = url.hostname;
      const port = url.port ? Number.parseInt(url.port, 10) : url.protocol === "https:" ? 443 : 80;
      // Append /projects/{id} to the base API path
      const path = `${url.pathname.replace(/\/$/, "")}/projects/${id}`;

      const projectData = await new Promise<ProjectDto>((resolve, reject) => {
        const options = {
          hostname: hostname,
          port: port,
          path: path,
          method: "GET",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
        };

        const req = https.request(options, (res) => {
          let responseData = "";

          res.on("data", (chunk) => {
            responseData += chunk;
          });

          res.on("end", () => {
            if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
              try {
                const parsedData = JSON.parse(responseData);
                resolve(parsedData);
              } catch (error) {
                reject(new Error(`Failed to parse JSON response: ${formatErrorMessage(error)}`));
              }
            } else {
              reject(new Error(`API call failed: ${res.statusCode} ${res.statusMessage}`));
            }
          });
        });

        req.on("error", (error) => {
          reject(error);
        });

        req.end();
      });

      const desktopAgentProjectPrompt = projectData.desktopAgentProjectPrompt;
      console.log("[PromptManager] Portal project prompt diagnostics", {
        projectId: id,
        hasDesktopPromptValue: Boolean(desktopAgentProjectPrompt),
        hasDesktopPromptContent: Boolean(desktopAgentProjectPrompt?.trim()),
        desktopPromptLength: desktopAgentProjectPrompt?.length ?? 0,
        hasLegacyVideoRule: desktopAgentProjectPrompt?.includes("[▶️ Watch the video") ?? false,
      });

      return projectData;
    } catch (error) {
      console.error(`Failed to fetch project details for ${id}:`, error);
      throw error; // Propagate error so handling logic knows it failed
    }
  }
}
