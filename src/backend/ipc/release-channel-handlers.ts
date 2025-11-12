import { app, ipcMain } from "electron";
import { autoUpdater } from "electron-updater";
import type { ReleaseChannel, ReleaseChannelType } from "../services/storage/release-channel-storage";
import { ReleaseChannelStorage } from "../services/storage/release-channel-storage";
import { IPC_CHANNELS } from "./channels";

interface GitHubRelease {
  id: number;
  tag_name: string;
  name: string;
  prerelease: boolean;
  published_at: string;
  html_url: string;
}

interface GitHubReleaseResponse {
  releases: GitHubRelease[];
  error?: string;
}

const GITHUB_API_BASE = "https://api.github.com";
const REPO_OWNER = "SSWConsulting";
const REPO_NAME = "SSW.YakShaver.Desktop";

export class ReleaseChannelIPCHandlers {
  private store = ReleaseChannelStorage.getInstance();

  constructor() {
    ipcMain.handle(IPC_CHANNELS.RELEASE_CHANNEL_GET, () => this.getChannel());
    ipcMain.handle(IPC_CHANNELS.RELEASE_CHANNEL_SET, (_, channel: ReleaseChannel) =>
      this.setChannel(channel),
    );
    ipcMain.handle(IPC_CHANNELS.RELEASE_CHANNEL_LIST_RELEASES, () => this.listReleases());
    ipcMain.handle(IPC_CHANNELS.RELEASE_CHANNEL_CHECK_UPDATES, () => this.checkForUpdates());
    ipcMain.handle(IPC_CHANNELS.RELEASE_CHANNEL_GET_CURRENT_VERSION, () => this.getCurrentVersion());
  }

  private async getChannel(): Promise<ReleaseChannel> {
    return await this.store.getChannel();
  }

  private async setChannel(channel: ReleaseChannel): Promise<void> {
    await this.store.setChannel(channel);
    // Reconfigure autoUpdater with new channel
    this.configureAutoUpdater(channel);
  }

  private async listReleases(): Promise<GitHubReleaseResponse> {
    try {
      const response = await fetch(
        `${GITHUB_API_BASE}/repos/${REPO_OWNER}/${REPO_NAME}/releases?per_page=100`,
      );

      if (!response.ok) {
        return {
          releases: [],
          error: `Failed to fetch releases: ${response.statusText}`,
        };
      }

      const releases: GitHubRelease[] = await response.json();
      return { releases };
    } catch (error) {
      return {
        releases: [],
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  private async checkForUpdates(): Promise<{ available: boolean; error?: string; version?: string }> {
    // Skip update checks in development/unpackaged mode
    if (!app.isPackaged) {
      return {
        available: false,
        error: "Update checks are only available in packaged applications",
      };
    }

    try {
      const channel = await this.getChannel();
      const currentVersion = this.getCurrentVersion();

      // For tag-based channels, check manually via GitHub API
      if (channel.type === "tag" && channel.tag) {
        const releases = await this.listReleases();
        if (releases.error) {
          return { available: false, error: releases.error };
        }

        const targetRelease = releases.releases.find((r) => r.tag_name === channel.tag);
        if (!targetRelease) {
          return { available: false, error: `Release ${channel.tag} not found` };
        }

        // Compare versions (simple string comparison, could be improved)
        const targetVersion = targetRelease.tag_name.replace(/^v/, "");
        const isNewer = this.compareVersions(targetVersion, currentVersion) > 0;
        
        return {
          available: isNewer,
          version: targetVersion,
        };
      }

      // For latest/prerelease, use standard autoUpdater
      this.configureAutoUpdater(channel);
      const result = await autoUpdater.checkForUpdates();
      
      if (result?.updateInfo) {
        const updateVersion = result.updateInfo.version;
        const isNewer = this.compareVersions(updateVersion, currentVersion) > 0;
        return {
          available: isNewer,
          version: updateVersion,
        };
      }

      return { available: false };
    } catch (error) {
      return {
        available: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  private compareVersions(v1: string, v2: string): number {
    // Simple version comparison - can be improved with semver library
    const parts1 = v1.split(/[.-]/).map(Number);
    const parts2 = v2.split(/[.-]/).map(Number);
    const maxLength = Math.max(parts1.length, parts2.length);

    for (let i = 0; i < maxLength; i++) {
      const part1 = parts1[i] || 0;
      const part2 = parts2[i] || 0;
      if (part1 > part2) return 1;
      if (part1 < part2) return -1;
    }
    return 0;
  }

  private getCurrentVersion(): string {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require("../../package.json").version;
  }

  public configureAutoUpdater(channel: ReleaseChannel): void {
    // Skip configuration in development/unpackaged mode
    if (!app.isPackaged) {
      return;
    }

    // Configure autoUpdater based on channel
    if (channel.type === "latest") {
      autoUpdater.channel = "latest";
      autoUpdater.allowPrerelease = false;
    } else if (channel.type === "prerelease") {
      autoUpdater.channel = "beta";
      autoUpdater.allowPrerelease = true;
    } else if (channel.type === "tag" && channel.tag) {
      // For specific tags, allow pre-releases and use tag as channel identifier
      // Note: electron-updater will check for the latest matching release
      // For precise tag matching, we use manual checking in checkForUpdates
      autoUpdater.channel = channel.tag;
      autoUpdater.allowPrerelease = true;
    }

    // Set update server (GitHub releases)
    autoUpdater.setFeedURL({
      provider: "github",
      owner: REPO_OWNER,
      repo: REPO_NAME,
      private: false,
    });
  }
}

