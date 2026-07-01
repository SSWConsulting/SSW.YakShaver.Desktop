import { ipcMain } from "electron";
import type { GitHubTokenVerification } from "../services/github/github-token-verifier";
import { verifyGitHubToken } from "../services/github/github-token-verifier";
import { GitHubTokenStorage } from "../services/storage/github-token-storage";
import { IPC_CHANNELS } from "./channels";

export class GitHubTokenIPCHandlers {
  private store = GitHubTokenStorage.getInstance();

  constructor() {
    ipcMain.handle(IPC_CHANNELS.GITHUB_TOKEN_GET, () => this.getToken());
    ipcMain.handle(IPC_CHANNELS.GITHUB_TOKEN_SET, (_, token: string) => this.setToken(token));
    ipcMain.handle(IPC_CHANNELS.GITHUB_TOKEN_CLEAR, () => this.clearToken());
    ipcMain.handle(IPC_CHANNELS.GITHUB_TOKEN_HAS, () => this.hasToken());
    ipcMain.handle(IPC_CHANNELS.GITHUB_TOKEN_VERIFY, () => this.verifyToken());
  }

  private async getToken(): Promise<string | undefined> {
    return await this.store.getToken();
  }

  private async setToken(token: string): Promise<void> {
    await this.store.setToken(token);
  }

  private async clearToken(): Promise<void> {
    await this.store.clearToken();
  }

  private async hasToken(): Promise<boolean> {
    return await this.store.hasToken();
  }

  private async verifyToken(): Promise<GitHubTokenVerification> {
    const token = await this.store.getToken();
    return verifyGitHubToken(token);
  }
}
