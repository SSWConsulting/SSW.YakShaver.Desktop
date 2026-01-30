import { ipcMain } from "electron";
import { type AuthState, AuthStatus } from "../services/auth/types";
import { YouTubeClient } from "../services/auth/youtube-client";
import { formatErrorMessage } from "../utils/error-utils";
import { IPC_CHANNELS } from "./channels";

export class AuthIPCHandlers {
  private readonly youtube = YouTubeClient.getInstance();

  constructor() {
    this.registerHandlers();
  }

  private registerHandlers() {
    const handlers = {
      [IPC_CHANNELS.YOUTUBE_START_AUTH]: () => this.youtube.authenticate(),
      [IPC_CHANNELS.YOUTUBE_GET_AUTH_STATUS]: () => this.getAuthStatus(),
      [IPC_CHANNELS.YOUTUBE_GET_CURRENT_USER]: () => this.youtube.getCurrentUser(),
      [IPC_CHANNELS.YOUTUBE_DISCONNECT]: async () => await this.youtube.disconnect(),
      [IPC_CHANNELS.YOUTUBE_REFRESH_TOKEN]: () => this.youtube.refreshTokens(),
      [IPC_CHANNELS.YOUTUBE_UPLOAD_VIDEO]: () => this.youtube.uploadVideo(),
      [IPC_CHANNELS.UPLOAD_RECORDED_VIDEO]: (_: unknown, filePath?: string) =>
        this.youtube.uploadVideo(filePath),
    };

    Object.entries(handlers).forEach(([channel, handler]) => {
      ipcMain.handle(channel, handler);
    });
  }

  private async getAuthStatus(): Promise<AuthState> {
    try {
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
