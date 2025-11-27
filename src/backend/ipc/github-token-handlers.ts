import { ipcMain } from "electron";
import { GitHubTokenStorage } from "../services/storage/github-token-storage";
import { IPC_CHANNELS } from "./channels";

export class GitHubTokenIPCHandlers {
  private store = GitHubTokenStorage.getInstance();

  constructor() {
    ipcMain.handle(IPC_CHANNELS.GITHUB_TOKEN_GET, () => this.getToken());
    ipcMain.handle(IPC_CHANNELS.GITHUB_TOKEN_SET, (_, token: string) => this.setToken(token));
    ipcMain.handle(IPC_CHANNELS.GITHUB_TOKEN_CLEAR, () => this.clearToken());
    ipcMain.handle(IPC_CHANNELS.GITHUB_TOKEN_HAS, () => this.hasToken());
    ipcMain.handle(IPC_CHANNELS.GITHUB_APP_GET_INSTALL_URL, () => this.getGitHubAppInstallUrl());
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

  private getGitHubAppInstallUrl(): string {
    const appSlug = process.env.GITHUB_APP_SLUG;
    const defaultUrl = process.env.GITHUB_APP_PUBLIC_LINK;

    if (defaultUrl) {
      return `${defaultUrl}/installations/new`;
    }

    if (appSlug) {
      return `https://github.com/apps/${appSlug}/installations/new`;
    }

    // Fallback to GitHub Apps installation page
    return "https://github.com/apps";
  }
}
