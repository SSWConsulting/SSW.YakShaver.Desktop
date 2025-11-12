import { app, dialog, ipcMain } from "electron";
import { autoUpdater } from "electron-updater";
import type { ReleaseChannel } from "../services/storage/release-channel-storage";
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
const REPO_OWNER = "babakamyljanovssw";
const REPO_NAME = "SSW.YakShaver.Desktop";
const RELEASES_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export class ReleaseChannelIPCHandlers {
  private store = ReleaseChannelStorage.getInstance();
  private releasesCache: {
    releases: GitHubRelease[];
    fetchedAt: number;
    etag?: string;
  } | null = null;
  private updateDownloaded = false;

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

    autoUpdater.on("update-available", (info) => {
      console.log("Update available:", info.version);
      console.log("Starting download...");
    });

    autoUpdater.on("update-not-available", (info) => {
      console.log("Update not available:", info.version);
    });

    autoUpdater.on("error", (err) => {
      console.error("AutoUpdater error:", err);
      console.error("Error details:", {
        message: err.message,
        stack: err.stack,
        channel: autoUpdater.channel,
      });
    });

    autoUpdater.on("download-progress", (progressObj) => {
      console.log(
        `Download speed: ${progressObj.bytesPerSecond} - Downloaded ${progressObj.percent}%`,
      );
    });

    autoUpdater.on("update-downloaded", (info) => {
      console.log("Update downloaded:", info.version);
      this.updateDownloaded = true;

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
    // Reconfigure autoUpdater with new channel
    this.configureAutoUpdater(channel);
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

      const githubToken = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
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
            ? "GitHub API rate limit exceeded. Please configure a GitHub token in the application .env file."
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
      return {
        releases: [],
        error: error instanceof Error ? error.message : "Unknown error",
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
      console.log("Update check skipped: app is not packaged");
      return {
        available: false,
        error: "Update checks are only available in packaged applications",
      };
    }

    try {
      const channel = await this.getChannel();
      const currentVersion = this.getCurrentVersion();
      console.log(`Checking for updates: current version ${currentVersion}, channel:`, channel);

      // For tag-based channels (PR releases)
      if (channel.type === "tag" && channel.tag) {
        const releases = await this.listReleases(true);
        if (releases.error) {
          console.error("Failed to fetch releases:", releases.error);
          return { available: false, error: releases.error };
        }

        // Find the release with matching tag
        // The workflow creates releases with tags like "0.3.7-beta.1731234567"
        const targetRelease = releases.releases.find((r) => r.tag_name === channel.tag);
        if (!targetRelease) {
          console.warn(`Release ${channel.tag} not found in ${releases.releases.length} releases`);
          return { available: false, error: `Release ${channel.tag} not found` };
        }

        console.log(`Found target release: ${targetRelease.name}, tag: ${targetRelease.tag_name}`);

        // The workflow creates beta versions with timestamp
        // Tag format: "0.3.7-beta.6.1762910147"
        // We check if user is on a different version than the selected tag
        const targetVersion = targetRelease.tag_name;
        const isCurrentlyOnThisVersion = currentVersion === targetVersion;

        console.log(
          `PR release check: tag=${channel.tag}, target version=${targetVersion}, current=${currentVersion}, match=${isCurrentlyOnThisVersion}`,
        );

        // If not on this version, trigger download
        if (!isCurrentlyOnThisVersion) {
          console.log("Triggering download for PR release...");

          // For PR-specific releases, use generic provider pointing to the specific release
          // Extract PR number from tag to get the correct yml filename (beta.11.yml format)
          const prMatch = channel.tag.match(/beta\.(\d+)\./);
          const channelName = prMatch ? `beta.${prMatch[1]}` : "beta";
          
          autoUpdater.setFeedURL({
            provider: "generic",
            url: `https://github.com/${REPO_OWNER}/${REPO_NAME}/releases/download/${channel.tag}`,
            channel: channelName,
          });
          
          autoUpdater.allowPrerelease = true;
          autoUpdater.allowDowngrade = true;

          console.log(`Configured generic provider for ${channel.tag}, channel: ${channelName}`);

          try {
            const result = await autoUpdater.checkForUpdates();
            if (result?.updateInfo) {
              console.log(`Update available: ${result.updateInfo.version}`);
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
            console.error("Failed to check/download update:", error);
            return {
              available: false,
              error: error instanceof Error ? error.message : "Failed to download update",
            };
          }
        }

        return {
          available: false,
          version: currentVersion,
        };
      }

      // For latest/prerelease, use standard autoUpdater
      this.configureAutoUpdater(channel);
      console.log(`Using autoUpdater for ${channel.type} channel`);

      // Reset allowDowngrade for stable releases
      autoUpdater.allowDowngrade = false;

      const result = await autoUpdater.checkForUpdates();

      if (result?.updateInfo) {
        const updateVersion = result.updateInfo.version;
        const isNewer = this.compareVersions(updateVersion, currentVersion) > 0;
        console.log(`Update found: ${updateVersion}, is newer: ${isNewer}`);
        return {
          available: isNewer,
          version: updateVersion,
        };
      }

      console.log("No updates found");
      return { available: false };
    } catch (error) {
      console.error("Update check failed:", error);
      return {
        available: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  private compareVersions(v1: string, v2: string): number {
    // Parse version strings that may include pre-release identifiers
    // e.g., "0.3.7", "0.3.7-pr.123", "1.0.0-beta.1"

    const parseVersion = (version: string) => {
      const match = version.match(/^(\d+)\.(\d+)\.(\d+)(?:-(.+))?$/);
      if (!match) {
        console.warn(`Invalid version format: ${version}`);
        return { major: 0, minor: 0, patch: 0, prerelease: "" };
      }
      return {
        major: Number.parseInt(match[1], 10),
        minor: Number.parseInt(match[2], 10),
        patch: Number.parseInt(match[3], 10),
        prerelease: match[4] || "",
      };
    };

    const v1Parts = parseVersion(v1);
    const v2Parts = parseVersion(v2);

    // Compare major, minor, patch
    if (v1Parts.major !== v2Parts.major) return v1Parts.major - v2Parts.major;
    if (v1Parts.minor !== v2Parts.minor) return v1Parts.minor - v2Parts.minor;
    if (v1Parts.patch !== v2Parts.patch) return v1Parts.patch - v2Parts.patch;

    // If versions are equal, check pre-release
    // No pre-release (stable) > pre-release
    if (!v1Parts.prerelease && v2Parts.prerelease) return 1;
    if (v1Parts.prerelease && !v2Parts.prerelease) return -1;
    if (!v1Parts.prerelease && !v2Parts.prerelease) return 0;

    // Both have pre-release, compare alphabetically
    return v1Parts.prerelease.localeCompare(v2Parts.prerelease);
  }

  private getCurrentVersion(): string {
    return app.getVersion();
  }

  public configureAutoUpdater(channel: ReleaseChannel): void {
    // Skip configuration in development/unpackaged mode
    if (!app.isPackaged) {
      return;
    }

    const githubToken = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
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
      console.log("Configured autoUpdater for latest channel");
    } else if (channel.type === "prerelease") {
      autoUpdater.channel = "beta";
      autoUpdater.allowPrerelease = true;
      autoUpdater.allowDowngrade = false;
      console.log("Configured autoUpdater for prerelease channel");
    } else if (channel.type === "tag" && channel.tag) {
      // For PR releases, extract PR number from version tag
      // Version format: "0.3.7-beta.{PR_NUMBER}.{TIMESTAMP}"
      // e.g., "0.3.7-beta.3.1762850000" -> channel "beta.3"
      const prMatch = channel.tag.match(/beta\.(\d+)\./);
      if (prMatch) {
        const prNumber = prMatch[1];
        autoUpdater.channel = `beta.${prNumber}`;
        console.log(`Configured autoUpdater for PR #${prNumber} → channel: beta.${prNumber}`);
      } else {
        // Fallback to generic beta channel for old format versions
        autoUpdater.channel = "beta";
        console.log(`Configured autoUpdater for tag ${channel.tag} → using beta channel`);
      }
      
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

    console.log(`AutoUpdater configured:`);
    console.log(`- Channel: ${autoUpdater.channel}`);
    console.log(`- Allow prerelease: ${autoUpdater.allowPrerelease}`);
    console.log(`- Allow downgrade: ${autoUpdater.allowDowngrade}`);
  }
}
