import https from "node:https";
import { config } from "../../config/env";
import { getDb } from "../../db/client";
import { prompts } from "../../db/schema";
import { formatErrorMessage } from "../../utils/error-utils"; // Import formatErrorMessage
import { MicrosoftAuthService } from "../auth/microsoft-auth";

// Define the Prompt interface that consolidates local and remote prompts
export interface PromptSummary {
  id: string; // UUID or string
  name: string;
  description?: string;
  isActive: boolean;
  source: "local" | "remote"; // To differentiate
}

// Define the ProjectSummaryDto interface based on the API response
interface ProjectSummaryDto {
  id: string; // Guid
  title: string;
  description?: string;
}

export class PromptManager {
  private static instance: PromptManager;
  private microsoftAuthService: MicrosoftAuthService;

  private constructor() {
    this.microsoftAuthService = MicrosoftAuthService.getInstance();
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
    // You might want to deduplicate or prioritize here if needed
    // For now, just concatenating them
    return [...localPrompts, ...remotePrompts];
  }

  /**
   * Retrieves prompts stored in the local SQLite database.
   */
  async getLocalPrompts(): Promise<PromptSummary[]> {
    try {
      const db = getDb();
      const localData = await db.select().from(prompts).all();

      return localData.map((p) => ({
        id: p.id,
        name: p.name,
        description: p.description ?? undefined, // Handle null/undefined
        isActive: p.isActive,
        updatedAt: p.updatedAt ?? undefined,
        source: "local",
      }));
    } catch (error) {
      console.error("Failed to fetch local prompts:", error);
      return []; // Return empty array on failure to allow partial results
    }
  }

  /**
   * Retrieves prompts from the remote API.
   * Endpoint: api.yakshaver.ai/api/projects/summaries
   */
  async getRemotePrompts(): Promise<PromptSummary[]> {
    try {
      const tokenResult = await this.microsoftAuthService.getToken();
      if (!tokenResult || !tokenResult.accessToken) {
        console.warn("No access token available for remote prompts.");
        return [];
      }

      const apiUrl = config.portalApiUrl();
      const url = new URL(apiUrl);
      const hostname = url.hostname;
      const port = url.port ? Number.parseInt(url.port, 10) : url.protocol === "https:" ? 443 : 80;
      // Append /projects/summaries to the base API path
      const path = `${url.pathname.replace(/\/$/, "")}/projects/summaries`;

      const data = await new Promise<ProjectSummaryDto[]>((resolve, reject) => {
        const options = {
          hostname: hostname,
          port: port,
          path: path,
          method: "GET",
          headers: {
            Authorization: `Bearer ${tokenResult.accessToken}`,
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
                // The API might return { data: [...] } or just [...]
                // Adjust based on actual API response structure.
                // Assuming it returns an array of project summaries which act as prompts.
                resolve(Array.isArray(parsedData) ? parsedData : []);
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

      // Map remote data to Prompt interface
      return data.map((item: ProjectSummaryDto) => ({
        id: item.id,
        name: item.title,
        description: item.description,
        isActive: true,
        source: "remote",
      }));
    } catch (error) {
      console.error("Failed to fetch remote prompts:", error);
      return []; // Return empty array on failure
    }
  }
}
