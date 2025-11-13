import { ipcMain } from "electron";
import { config } from "../config/env";
import { type AuthState, AuthStatus } from "../services/auth/types";
import { YouTubeAuthService } from "../services/auth/youtube-auth";
import { formatErrorMessage } from "../utils/error-utils";
import { IPC_CHANNELS } from "./channels";

export class AuthIPCHandlers {
  private readonly youtube = YouTubeAuthService.getInstance();

  constructor() {
    this.registerHandlers();
  }

  private registerHandlers() {
    const handlers = {
      [IPC_CHANNELS.YOUTUBE_START_AUTH]: () => this.youtube.authenticate(),
      [IPC_CHANNELS.YOUTUBE_GET_AUTH_STATUS]: () => this.getAuthStatus(),
      [IPC_CHANNELS.YOUTUBE_GET_CURRENT_USER]: () => this.youtube.getCurrentUser(),
      [IPC_CHANNELS.YOUTUBE_DISCONNECT]: async () => (await this.youtube.disconnect(), true),
      [IPC_CHANNELS.YOUTUBE_REFRESH_TOKEN]: () => this.youtube.refreshTokens(),
      [IPC_CHANNELS.YOUTUBE_UPLOAD_VIDEO]: () => this.youtube.uploadVideo(),
      [IPC_CHANNELS.UPLOAD_RECORDED_VIDEO]: (_: unknown, filePath?: string) =>
        this.youtube.uploadVideo(filePath),
      [IPC_CHANNELS.CONFIG_HAS_YOUTUBE]: () => config.youtube() !== null,
      [IPC_CHANNELS.CONFIG_GET_YOUTUBE]: () => config.youtube(),
    };

    Object.entries(handlers).forEach(([channel, handler]) => {
      ipcMain.handle(channel, handler);
    });
  }

  private async getAuthStatus(): Promise<AuthState> {
    try {
      if (!config.youtube()) {
        return {
          status: AuthStatus.ERROR,
          error: "YouTube configuration not found",
        };
      }

      if (!(await this.youtube.isAuthenticated())) {
        return { status: AuthStatus.NOT_AUTHENTICATED };
      }

      const userInfo = await this.youtube.getCurrentUser();
      return {
        status: AuthStatus.AUTHENTICATED,
        userInfo: userInfo || undefined,
      };
    } catch (error) {
      return {
        status: AuthStatus.ERROR,
        error: formatErrorMessage(error),
      };
    }
  }
}
