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
  body?: string;
  prerelease: boolean;
  published_at: string;
  html_url: string;
}

interface ProcessedRelease {
  prNumber: string;
  tag: string;
  version: string;
  publishedAt: string;
}

interface GitHubReleaseResponse {
  releases: ProcessedRelease[];
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
  private updateCheckInterval: NodeJS.Timeout | null = null;
  private readonly UPDATE_CHECK_INTERVAL = 10 * 60 * 1000; // Check every 10 minutes

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

    autoUpdater.on("checking-for-update", () => {
      console.log("Checking for updates...");
      dialog.showMessageBox({
        type: "info",
        title: "Checking for Updates",
        message: "Checking for updates...",
        buttons: ["OK"],
      });
    });

    autoUpdater.on("update-available", (info) => {
      console.log("Update available:", info.version);
      dialog.showMessageBox({
        type: "info",
        title: "Update Available",
        message: `Version ${info.version} is available. Downloading now...`,
        buttons: ["OK"],
      });
    });

    autoUpdater.on("update-not-available", (info) => {
      console.log("Update not available. Current version:", info.version);
      dialog.showMessageBox({
        type: "info",
        title: "No Updates",
        message: `You are on the latest version (${info.version}).`,
        buttons: ["OK"],
      });
    });

    autoUpdater.on("download-progress", (progressObj) => {
      console.log(`Download progress: ${Math.round(progressObj.percent)}%`);
      dialog.showMessageBox({
        type: "info",
        title: "Download Progress",
        message: `Download progress: ${Math.round(progressObj.percent)}%`,
        buttons: ["OK"],
      });
    });

    autoUpdater.on("update-downloaded", () => {
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
    this.startPeriodicUpdateChecks();
  }

  private async listReleases(forceRefresh = false): Promise<GitHubReleaseResponse> {
    try {
      if (
        !forceRefresh &&
        this.releasesCache &&
        Date.now() - this.releasesCache.fetchedAt < RELEASES_CACHE_TTL
      ) {
        return { releases: this.processReleases(this.releasesCache.releases) };
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
        return { releases: this.processReleases(this.releasesCache.releases) };
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

      return { releases: this.processReleases(releases) };
    } catch (error) {
      const errMsg = formatErrorMessage(error);
      return {
        releases: [],
        error: errMsg,
      };
    }
  }

  /**
   * Process raw GitHub releases into frontend-ready data:
   * - Filter to prereleases only
   * - Extract PR numbers
   * - Group by PR and keep only the latest release per PR
   * - Sort by PR number descending
   */
  private processReleases(releases: GitHubRelease[]): ProcessedRelease[] {
    // Filter prereleases
    const prereleases = releases.filter((r) => r.prerelease);

    // Sort by published date (newest first)
    const sorted = prereleases.sort(
      (a, b) => new Date(b.published_at).getTime() - new Date(a.published_at).getTime(),
    );

    // Group by PR number, keeping only the latest release for each PR
    const prMap = new Map<string, GitHubRelease>();
    for (const release of sorted) {
      const prNumber = this.extractPRNumber(release);
      if (prNumber && !prMap.has(prNumber)) {
        prMap.set(prNumber, release);
      }
    }

    // Convert to processed releases, sorted by PR number descending
    return Array.from(prMap.entries())
      .sort((a, b) => Number.parseInt(b[0], 10) - Number.parseInt(a[0], 10))
      .map(([prNumber, release]) => ({
        prNumber,
        tag: release.tag_name,
        version: release.tag_name,
        publishedAt: release.published_at,
      }));
  }

  /**
   * Extract PR number from release name or body
   */
  private extractPRNumber(release: GitHubRelease): string | null {
    const prMatch = release.name?.match(/PR #(\d+)/) || release.body?.match(/PR #(\d+)/);
    return prMatch ? prMatch[1] : null;
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

      // For PR channels
      if (channel.type === "pr" && channel.channel) {
        // Get raw releases for update checking (not processed)
        if (!this.releasesCache || Date.now() - this.releasesCache.fetchedAt > RELEASES_CACHE_TTL) {
          await this.listReleases(true);
        }

        if (!this.releasesCache) {
          return { available: false, error: "Failed to fetch releases" };
        }

        // Find the latest release for this PR channel
        // Channel format: "beta.15"
        const prMatch = channel.channel.match(/beta\.(\d+)/);
        if (!prMatch) {
          return { available: false, error: `Invalid channel format: ${channel.channel}` };
        }
        const prNumber = prMatch[1];

        // Find all releases for this PR, sorted by published date (newest first)
        const prReleases = this.releasesCache.releases
          .filter((r) => {
            const releasePrMatch = this.extractPRNumber(r);
            return releasePrMatch === prNumber;
          })
          .sort((a, b) => new Date(b.published_at).getTime() - new Date(a.published_at).getTime());

        if (prReleases.length === 0) {
          return { available: false, error: `No releases found for PR #${prNumber}` };
        }

        const latestRelease = prReleases[0];
        const targetVersion = latestRelease.tag_name;
        const isCurrentlyOnThisVersion = currentVersion === targetVersion;

        // If not on this version, trigger download
        if (!isCurrentlyOnThisVersion) {
          autoUpdater.setFeedURL({
            provider: "generic",
            url: `https://github.com/${REPO_OWNER}/${REPO_NAME}/releases/download/${targetVersion}`,
            channel: channel.channel,
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
   * Start periodic update checks in the background
   */
  private startPeriodicUpdateChecks(): void {
    // Clear any existing interval
    if (this.updateCheckInterval) {
      clearInterval(this.updateCheckInterval);
    }

    // Skip in development/unpackaged mode
    if (!app.isPackaged) {
      return;
    }

    console.log(
      `Starting periodic update checks (every ${this.UPDATE_CHECK_INTERVAL / 60000} minutes)`,
    );

    // Set up periodic checks
    this.updateCheckInterval = setInterval(() => {
      console.log("Running periodic update check...");
      autoUpdater.checkForUpdates().catch((err) => {
        console.error("Periodic update check failed:", err);
      });
    }, this.UPDATE_CHECK_INTERVAL);
  }

  /**
   * Stop periodic update checks
   */
  public stopPeriodicUpdateChecks(): void {
    if (this.updateCheckInterval) {
      clearInterval(this.updateCheckInterval);
      this.updateCheckInterval = null;
    }
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

      // Set update server (GitHub releases)
      autoUpdater.setFeedURL({
        provider: "github",
        owner: REPO_OWNER,
        repo: REPO_NAME,
        private: false,
      });
    } else if (channel.type === "pr" && channel.channel) {
      // For PR channels, we need to find the latest release tag first
      const prMatch = channel.channel.match(/beta\.(\d+)/);
      if (prMatch) {
        const prNumber = prMatch[1];

        // Get the latest release for this PR
        if (!this.releasesCache || Date.now() - this.releasesCache.fetchedAt > RELEASES_CACHE_TTL) {
          await this.listReleases(true);
        }

        if (this.releasesCache) {
          const prReleases = this.releasesCache.releases
            .filter((r) => this.extractPRNumber(r) === prNumber)
            .sort(
              (a, b) => new Date(b.published_at).getTime() - new Date(a.published_at).getTime(),
            );

          if (prReleases.length > 0) {
            const latestRelease = prReleases[0];

            // Set channel and settings BEFORE setFeedURL
            autoUpdater.channel = channel.channel;
            autoUpdater.allowPrerelease = true;
            autoUpdater.allowDowngrade = true;

            autoUpdater.setFeedURL({
              provider: "generic",
              url: `https://github.com/${REPO_OWNER}/${REPO_NAME}/releases/download/${latestRelease.tag_name}`,
              channel: channel.channel,
            });

            const currentVersion = app.getVersion();
            const isOnLatest = currentVersion === latestRelease.tag_name;

            console.log(`Configured auto-updater for PR #${prNumber}`);
            console.log(`  Current version: ${currentVersion}`);
            console.log(`  Latest release: ${latestRelease.tag_name}`);
            console.log(`  Up to date: ${isOnLatest}`);

            // Show notification if not on latest
            if (!isOnLatest) {
              dialog.showMessageBox({
                type: "info",
                title: "PR Channel Configured",
                message: `Monitoring PR #${prNumber} for updates.\n\nCurrent: ${currentVersion}\nLatest: ${latestRelease.tag_name}\n\nAuto-update will check every 10 minutes.`,
                buttons: ["OK"],
              });
            }
          } else {
            console.warn(`No releases found for PR #${prNumber}`);
          }
        }
      }
    }

    this.startPeriodicUpdateChecks();
  }
}
