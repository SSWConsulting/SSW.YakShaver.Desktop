import { app, dialog, ipcMain } from "electron";
import { autoUpdater } from "electron-updater";
import { GitHubTokenStorage } from "../services/storage/github-token-storage";
import type { ReleaseChannel } from "../services/storage/release-channel-storage";
import { ReleaseChannelStorage } from "../services/storage/release-channel-storage";
import { formatErrorMessage } from "../utils/error-utils";
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
const RELEASES_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export class ReleaseChannelIPCHandlers {
  private store = ReleaseChannelStorage.getInstance();
  private tokenStore = GitHubTokenStorage.getInstance();
  private releasesCache: {
    releases: GitHubRelease[];
    fetchedAt: number;
    etag?: string;
  } | null = null;

  constructor() {
    ipcMain.handle(IPC_CHANNELS.RELEASE_CHANNEL_GET, () => this.getChannel());
    ipcMain.handle(IPC_CHANNELS.RELEASE_CHANNEL_SET, (_, channel: ReleaseChannel) =>
      this.setChannel(channel),
    );
    ipcMain.handle(IPC_CHANNELS.RELEASE_CHANNEL_LIST_RELEASES, () => this.listReleases());
    ipcMain.handle(IPC_CHANNELS.RELEASE_CHANNEL_CHECK_UPDATES, () => this.checkForUpdates());
    ipcMain.handle(IPC_CHANNELS.RELEASE_CHANNEL_GET_CURRENT_VERSION, () =>
      this.getCurrentVersion(),
    );

    // Setup autoUpdater event listeners
    this.setupAutoUpdaterListeners();
  }

  private setupAutoUpdaterListeners(): void {
    // Enable automatic download
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;

    autoUpdater.on("update-downloaded", (info) => {
      dialog
        .showMessageBox({
          type: "info",
          title: "Update Ready",
          message: "A new version has been downloaded. Restart now to install?",
          buttons: ["Restart Now", "Later"],
          defaultId: 0,
          cancelId: 1,
        })
        .then((result) => {
          if (result.response === 0) {
            // Force immediate quit and install
            setImmediate(() => {
              // isSilent: false, isForceRunAfter: true, check docs: https://www.jsdocs.io/package/electron-updater#AppUpdater.quitAndInstall
              autoUpdater.quitAndInstall(false, true);
            });
          }
        })
        .catch((err) => {
          console.error("Error showing update dialog:", err);
        });
    });
  }

  private async getChannel(): Promise<ReleaseChannel> {
    return await this.store.getChannel();
  }

  private async setChannel(channel: ReleaseChannel): Promise<void> {
    await this.store.setChannel(channel);
    await this.configureAutoUpdater(channel);
  }

  private async listReleases(forceRefresh = false): Promise<GitHubReleaseResponse> {
    try {
      if (
        !forceRefresh &&
        this.releasesCache &&
        Date.now() - this.releasesCache.fetchedAt < RELEASES_CACHE_TTL
      ) {
        return { releases: this.releasesCache.releases };
      }

      const headers: Record<string, string> = {
        Accept: "application/vnd.github+json",
        "User-Agent": `${app.getName()}/${app.getVersion()}`,
      };

      const githubToken = await this.tokenStore.getToken();
      if (githubToken) {
        headers.Authorization = `Bearer ${githubToken}`;
      }

      if (this.releasesCache?.etag) {
        headers["If-None-Match"] = this.releasesCache.etag;
      }

      const response = await fetch(
        `${GITHUB_API_BASE}/repos/${REPO_OWNER}/${REPO_NAME}/releases?per_page=100`,
        {
          headers,
        },
      );

      if (response.status === 304 && this.releasesCache) {
        this.releasesCache.fetchedAt = Date.now();
        return { releases: this.releasesCache.releases };
      }

      if (!response.ok) {
        const errorBody = await response.text();
        const baseError = `Failed to fetch releases: ${response.statusText}`;
        const errorMessage =
          response.status === 403 && /rate limit/i.test(errorBody)
            ? "GitHub API rate limit exceeded. Please configure a GitHub token in Settings | GitHub Token"
            : baseError;

        return {
          releases: [],
          error: errorMessage,
        };
      }

      const releases: GitHubRelease[] = await response.json();
      this.releasesCache = {
        releases,
        fetchedAt: Date.now(),
        etag: response.headers.get("etag") ?? undefined,
      };

      return { releases };
    } catch (error) {
      const errMsg = formatErrorMessage(error);
      return {
        releases: [],
        error: errMsg,
      };
    }
  }

  private async checkForUpdates(): Promise<{
    available: boolean;
    error?: string;
    version?: string;
  }> {
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

      // For tag-based channels (PR releases)
      if (channel.type === "tag" && channel.tag) {
        const releases = await this.listReleases(true);
        if (releases.error) {
          return { available: false, error: releases.error };
        }

        // Find the release with matching tag
        const targetRelease = releases.releases.find((r) => r.tag_name === channel.tag);
        if (!targetRelease) {
          return { available: false, error: `Release ${channel.tag} not found` };
        }

        // The workflow creates beta versions with timestamp
        // Tag format: "0.3.7-beta.11.1762910147"
        const targetVersion = targetRelease.tag_name;
        const isCurrentlyOnThisVersion = currentVersion === targetVersion;

        // If not on this version, trigger download
        if (!isCurrentlyOnThisVersion) {
          const channelName = this.extractChannelFromTag(channel.tag);
          autoUpdater.setFeedURL({
            provider: "generic",
            url: `https://github.com/${REPO_OWNER}/${REPO_NAME}/releases/download/${channel.tag}`,
            channel: channelName,
          });
          autoUpdater.allowPrerelease = true;
          autoUpdater.allowDowngrade = true;

          try {
            const result = await autoUpdater.checkForUpdates();
            if (result?.updateInfo) {
              return {
                available: true,
                version: targetVersion,
              };
            } else {
              return {
                available: false,
                error:
                  "No update found. Ensure the PR release includes the correct beta.{PR}.yml manifest.",
              };
            }
          } catch (error) {
            const errMsg = formatErrorMessage(error);
            return {
              available: false,
              error: errMsg,
            };
          }
        }

        return {
          available: false,
          version: currentVersion,
        };
      }

      // For latest stable channel, use GitHub provider
      await this.configureAutoUpdater(channel);
      autoUpdater.allowDowngrade = false;

      const result = await autoUpdater.checkForUpdates();

      if (result?.updateInfo) {
        const updateVersion = result.updateInfo.version;
        return {
          available: updateVersion !== currentVersion,
          version: updateVersion,
        };
      }
      return { available: false };
    } catch (error) {
      const errMsg = formatErrorMessage(error);
      return {
        available: false,
        error: errMsg,
      };
    }
  }

  private getCurrentVersion(): string {
    return app.getVersion();
  }

  /**
   * Extract PR number from a beta tag and return the channel name
   * @param tag - Version tag like "0.3.7-beta.11.1234567890"
   * @returns Channel name like "beta.11" or "beta" if no match
   */
  private extractChannelFromTag(tag: string): string {
    const prMatch = tag.match(/beta\.(\d+)\./);
    return prMatch ? `beta.${prMatch[1]}` : "beta";
  }

  public async configureAutoUpdater(channel: ReleaseChannel): Promise<void> {
    // Skip configuration in development/unpackaged mode
    if (!app.isPackaged) {
      return;
    }

    const githubToken = await this.tokenStore.getToken();
    if (githubToken) {
      autoUpdater.requestHeaders = {
        ...autoUpdater.requestHeaders,
        Authorization: `Bearer ${githubToken}`,
      };
    }

    // Configure autoUpdater based on channel
    if (channel.type === "latest") {
      autoUpdater.channel = "latest";
      autoUpdater.allowPrerelease = false;
      autoUpdater.allowDowngrade = false;
    } else if (channel.type === "tag" && channel.tag) {
      autoUpdater.channel = this.extractChannelFromTag(channel.tag);
      autoUpdater.allowPrerelease = true;
      autoUpdater.allowDowngrade = true;
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
