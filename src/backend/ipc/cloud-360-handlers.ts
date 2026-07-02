import { ipcMain } from "electron";
import { IdentityServerAuthService } from "../services/auth/identity-server-auth";
import { fetchGitHubProjects } from "../services/yakshaver360/github-projects";
import type { Cloud360Project } from "../../shared/types/cloud360";
import { IPC_CHANNELS } from "./channels";

export class Cloud360IPCHandlers {
  private auth = IdentityServerAuthService.getInstance();

  constructor() {
    ipcMain.handle(IPC_CHANNELS.CLOUD360_LIST_PROJECTS, async (): Promise<Cloud360Project[]> => {
      const token = await this.auth.getAccessToken();
      if (!token) {
        throw new Error("Not signed in: sign in to YakShaver to list projects.");
      }
      return fetchGitHubProjects(token);
    });
  }
}
