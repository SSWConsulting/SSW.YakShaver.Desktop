import { ipcMain } from "electron";
import type { Cloud360Project } from "../../shared/types/cloud360";
import { IdentityServerAuthService } from "../services/auth/identity-server-auth";
import {
  checkCloud360Credits,
  type CreditPrecheckResult,
} from "../services/yakshaver360/credit-precheck";
import { fetchGitHubProjects } from "../services/yakshaver360/github-projects";
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

    // Asked by the project dialog before recording starts, so a user with no credits never reaches
    // the source picker (issue #3899). Fails open — a signed-out user or unreachable backend must
    // not block a shave here; the 360 process route still rejects with 402.
    ipcMain.handle(
      IPC_CHANNELS.CLOUD360_CHECK_CREDITS,
      async (): Promise<CreditPrecheckResult> => {
        const token = await this.auth.getAccessToken();
        if (!token) {
          return { canShave: true };
        }
        return checkCloud360Credits(token);
      },
    );
  }
}
