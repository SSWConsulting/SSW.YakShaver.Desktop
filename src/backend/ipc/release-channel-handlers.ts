import { app, BrowserWindow, dialog, ipcMain } from "electron";
import { autoUpdater } from "electron-updater";
import { config } from "../config/env";
import { setIsQuitting } from "../index";
import { verifyGitHubToken } from "../services/github/github-token-verifier";
import { GitHubTokenStorage } from "../services/storage/github-token-storage";
import type { ReleaseChannel } from "../services/storage/release-channel-storage";
import { ReleaseChannelStorage } from "../services/storage/release-channel-storage";
import { formatAndReportError } from "../utils/error-utils";
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
// PR releases are gated on the configured GitHub token being valid (#919): an invalid/expired
// token must not be usable to list, select, or download PR builds. Cache the verification briefly
// so every list/select/download call doesn't re-hit the GitHub /user endpoint.
const TOKEN_HEALTH_CACHE_TTL = 60 * 1000; // 1 minute
const INVALID_TOKEN_ERROR =
  "GitHub token is invalid or expired. Update it in Settings | GitHub Token to use PR releases.";
// Distinct from INVALID_TOKEN_ERROR (review on #919) — "no token saved" and "saved but invalid"
// are different states and must not share the same "invalid or expired" wording, otherwise a user
// who never configured a token gets a misleading "invalid" error on every Settings load.
const NO_TOKEN_ERROR =
  "A GitHub token is required to list, select, or download PR releases. Add one in Settings | GitHub Token.";
const RATE_LIMITED_ERROR =
  "GitHub API rate limit exceeded while verifying your token. Your token is fine — try again shortly.";
// Distinct from INVALID_TOKEN_ERROR (review on #939) — a transport failure (offline, DNS, TLS,
// timeout, GitHub outage) while calling the GitHub API is not evidence the token itself is bad, so
// it must not be reported as "invalid or expired" either. verifyGitHubToken()'s catch block is the
// only path that produces an error string other than "Invalid or expired token" / "Rate limit
// exceeded", so that's what isNetworkError below keys off.
const VERIFICATION_UNAVAILABLE_ERROR =
  "Couldn't verify your GitHub token right now (network error). Check your connection and try again.";

export class ReleaseChannelIPCHandlers {
  private store = ReleaseChannelStorage.getInstance();
  private tokenStore = GitHubTokenStorage.getInstance();
  private releasesCache: {
    releases: GitHubRelease[];
    fetchedAt: number;
    etag?: string;
  } | null = null;
  private tokenHealthCache: {
    isValid: boolean;
    checkedAt: number;
    token: string;
    isRateLimited: boolean;
    isNetworkError: boolean;
    error?: string;
  } | null = null;
  private updateCheckInterval: NodeJS.Timeout | null = null;
  private readonly UPDATE_CHECK_INTERVAL = 10 * 60 * 1000; // Check every 10 minutes
  private updateDialogDismissedInSession = false; // Track if user dismissed update dialog this session
  // Track whether the "Update Ready" dialog is currently open (#456) - guards against a second
  // autoUpdater "update-downloaded" event (e.g. a periodic re-check landing while the first
  // dialog is still awaiting a response) from stacking a duplicate dialog on top of it.
  private isUpdateDialogOpen = false;

  constructor() {
    ipcMain.handle(IPC_CHANNELS.RELEASE_CHANNEL_GET, () => this.getChannel());
    ipcMain.handle(IPC_CHANNELS.RELEASE_CHANNEL_SET, (_, channel: ReleaseChannel) =>
      this.setChannel(channel),
    );
    ipcMain.handle(IPC_CHANNELS.RELEASE_CHANNEL_LIST_RELEASES, () => this.listReleases());
    ipcMain.handle(IPC_CHANNELS.RELEASE_CHANNEL_CHECK_UPDATES, () => this.checkForUpdates());
    ipcMain.handle(IPC_CHANNELS.RELEASE_CHANNEL_GET_CURRENT_VERSION, () => ({
      version: this.getCurrentVersion(),
      commitHash: config.commitHash(),
    }));

    // Setup autoUpdater event listeners
    this.setupAutoUpdaterListeners();
  }

  private setupAutoUpdaterListeners(): void {
    // Enable automatic download
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;

    autoUpdater.on("download-progress", (progressObj) => {
      // Send progress to all windows
      BrowserWindow.getAllWindows().forEach((win) => {
        if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
          win.webContents.send(IPC_CHANNELS.RELEASE_CHANNEL_DOWNLOAD_PROGRESS, {
            percent: Math.round(progressObj.percent),
            transferred: progressObj.transferred,
            total: progressObj.total,
          });
        }
      });
    });

    autoUpdater.on("update-downloaded", () => {
      // Skip showing dialog if user already dismissed it this session (#456) - once "Later" is
      // clicked, no further reminder should appear for the rest of the current session.
      if (this.updateDialogDismissedInSession) {
        return;
      }

      // Skip if a reminder dialog is already open (#456) - a subsequent "update-downloaded" event
      // (e.g. the periodic background check firing again) must not stack another dialog on top of
      // one the user hasn't responded to yet.
      if (this.isUpdateDialogOpen) {
        return;
      }
      this.isUpdateDialogOpen = true;

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
            // Set isQuitting to true so that the before-quit handler allows the app to quit
            setIsQuitting(true);
            // Force immediate quit and install
            setImmediate(() => {
              // isSilent: false, isForceRunAfter: true, check docs: https://www.jsdocs.io/package/electron-updater#AppUpdater.quitAndInstall
              autoUpdater.quitAndInstall(false, true);
            });
          } else {
            // User chose "Later" - remember this for the current session so no further reminder
            // is shown, whether from another "update-downloaded" event or the periodic check.
            this.updateDialogDismissedInSession = true;
          }
        })
        .catch((err) => {
          console.error("Error showing update dialog:", err);
        })
        .finally(() => {
          this.isUpdateDialogOpen = false;
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

  /**
   * PR release channels require a healthy (valid, non-expired) GitHub token (#919) — invalid
   * tokens must not be usable to list/select/download PR builds. The "latest" stable channel is
   * unaffected: it doesn't need a token at all.
   *
   * Cached briefly per-token so repeated list/select/download calls in quick succession don't each
   * re-verify against the GitHub API.
   *
   * Returns a small status object rather than a bare boolean (review on #919) so callers can tell
   * apart four distinct states that all render as "not healthy" but need different treatment:
   *   - no token saved at all — not an error, just an unconfigured feature (NO_TOKEN_ERROR)
   *   - a rate-limited check — the token itself may be fine, GitHub is just throttling us
   *     (RATE_LIMITED_ERROR)
   *   - a transport failure (offline/DNS/TLS/timeout/GitHub outage) verifying the token — the token
   *     itself was never actually checked, so this must not read as "invalid" either
   *     (VERIFICATION_UNAVAILABLE_ERROR, review on #939)
   *   - an actually invalid/expired token (INVALID_TOKEN_ERROR)
   */
  private async isGitHubTokenHealthy(forceRefresh = false): Promise<{
    healthy: boolean;
    noToken: boolean;
    isRateLimited: boolean;
    isNetworkError: boolean;
    error?: string;
  }> {
    const token = await this.tokenStore.getToken();
    if (!token) {
      return { healthy: false, noToken: true, isRateLimited: false, isNetworkError: false };
    }

    if (
      !forceRefresh &&
      this.tokenHealthCache &&
      this.tokenHealthCache.token === token &&
      Date.now() - this.tokenHealthCache.checkedAt < TOKEN_HEALTH_CACHE_TTL
    ) {
      return {
        healthy: this.tokenHealthCache.isValid,
        noToken: false,
        isRateLimited: this.tokenHealthCache.isRateLimited,
        isNetworkError: this.tokenHealthCache.isNetworkError,
        error: this.tokenHealthCache.error,
      };
    }

    const verification = await verifyGitHubToken(token);
    // verifyGitHubToken() distinguishes a 401 ("Invalid or expired token") and a 403 rate-limit
    // ("Rate limit exceeded") from a transport failure — its catch block is the only path that
    // produces any other error string (the raw fetch/DNS/TLS error text) — key off that same text
    // rather than re-deriving it, so this stays in sync with the shared helper without duplicating
    // its logic.
    const isRateLimited = !verification.isValid && verification.error === "Rate limit exceeded";
    const isNetworkError =
      !verification.isValid &&
      !isRateLimited &&
      verification.error !== undefined &&
      verification.error !== "Invalid or expired token";
    this.tokenHealthCache = {
      isValid: verification.isValid,
      checkedAt: Date.now(),
      token,
      isRateLimited,
      isNetworkError,
      error: verification.error,
    };
    return {
      healthy: verification.isValid,
      noToken: false,
      isRateLimited,
      isNetworkError,
      error: verification.error,
    };
  }

  /**
   * Map an isGitHubTokenHealthy() result to the user-facing error string for the four unhealthy
   * states (review on #919, #939) — kept in one place so listReleases/checkForUpdates/
   * configureAutoUpdater all report the same distinction consistently.
   */
  private tokenHealthErrorMessage(health: {
    noToken: boolean;
    isRateLimited: boolean;
    isNetworkError: boolean;
  }): string {
    if (health.noToken) {
      return NO_TOKEN_ERROR;
    }
    if (health.isRateLimited) {
      return RATE_LIMITED_ERROR;
    }
    if (health.isNetworkError) {
      return VERIFICATION_UNAVAILABLE_ERROR;
    }
    return INVALID_TOKEN_ERROR;
  }

  private async listReleases(forceRefresh = false): Promise<GitHubReleaseResponse> {
    try {
      const tokenHealth = await this.isGitHubTokenHealthy();
      if (!tokenHealth.healthy) {
        return { releases: [], error: this.tokenHealthErrorMessage(tokenHealth) };
      }

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
      const errMsg = formatAndReportError(error, "fetch_releases");
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
      .sort(
        ([prNumberA], [prNumberB]) =>
          Number.parseInt(prNumberB, 10) - Number.parseInt(prNumberA, 10),
      )
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

  /**
   * Get all releases for a specific PR number, sorted by published date (newest first)
   */
  private getPRReleases(prNumber: string): GitHubRelease[] {
    if (!this.releasesCache) {
      return [];
    }

    return this.releasesCache.releases
      .filter((r) => this.extractPRNumber(r) === prNumber)
      .sort((a, b) => new Date(b.published_at).getTime() - new Date(a.published_at).getTime());
  }

  /**
   * Extract PR number from channel format (e.g., "beta.15" -> "15")
   * @returns PR number or null if format is invalid
   */
  private extractPRNumberFromChannel(channel: string): string | null {
    const prMatch = channel.match(/beta\.(\d+)/);
    return prMatch ? prMatch[1] : null;
  }

  private async checkForUpdates(): Promise<{
    available: boolean;
    error?: string;
    version?: string;
    currentVersion?: string;
  }> {
    // Skip update checks in development/unpackaged mode
    if (!app.isPackaged) {
      return {
        available: false,
        error: "Update checks are only available in packaged applications",
        currentVersion: this.getCurrentVersion(),
      };
    }

    const currentVersion = this.getCurrentVersion();

    try {
      const channel = await this.getChannel();

      // For PR channels
      if (channel.type === "pr" && channel.channel) {
        // PR releases require a healthy GitHub token (#919) — block before touching the releases
        // cache, the GitHub API, or the autoUpdater so an invalid token can never trigger a
        // download. This is the explicit, user-initiated "Check for Updates" action, so bypass the
        // 60s token-health cache: a user who just fixed their token shouldn't be stuck seeing
        // "invalid" for up to a minute after retrying.
        const tokenHealth = await this.isGitHubTokenHealthy(true);
        if (!tokenHealth.healthy) {
          return { available: false, error: this.tokenHealthErrorMessage(tokenHealth) };
        }

        // Get raw releases for update checking (not processed)
        if (!this.releasesCache || Date.now() - this.releasesCache.fetchedAt > RELEASES_CACHE_TTL) {
          await this.listReleases(true);
        }

        if (!this.releasesCache) {
          return { available: false, error: "Failed to fetch releases", currentVersion };
        }

        const prNumber = this.extractPRNumberFromChannel(channel.channel);
        if (!prNumber) {
          return {
            available: false,
            error: `Invalid channel format: ${channel.channel}`,
            currentVersion,
          };
        }
        const prReleases = this.getPRReleases(prNumber);
        if (prReleases.length === 0) {
          return {
            available: false,
            error: `No releases found for PR #${prNumber}`,
            currentVersion,
          };
        }

        const latestRelease = prReleases[0];
        const targetVersion = latestRelease.tag_name;
        const isCurrentlyOnThisVersion = currentVersion === targetVersion;

        // If not on this version, trigger download
        if (!isCurrentlyOnThisVersion) {
          // Explicitly set the channel before configuring feed URL
          autoUpdater.channel = channel.channel;
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
                currentVersion,
              };
            } else {
              return {
                available: false,
                error:
                  "No update found. Ensure the PR release includes the correct beta.{PR}.yml manifest.",
                currentVersion,
              };
            }
          } catch (error) {
            const errMsg = formatAndReportError(error, "check_prerelease");
            return {
              available: false,
              error: errMsg,
              currentVersion,
            };
          }
        }

        return {
          available: false,
          version: currentVersion,
          currentVersion,
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
          currentVersion,
        };
      }
      return { available: false, currentVersion };
    } catch (error) {
      const errMsg = formatAndReportError(error, "check_update");
      return {
        available: false,
        error: errMsg,
        currentVersion,
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

    // Set up periodic checks — routed through this.checkForUpdates() (not the autoUpdater
    // directly) so the same token-health gate that guards the manual "Check for Updates" button
    // and listReleases() also covers this background timer (#919). Without this, a PR channel
    // configured while the token was healthy would keep polling the PR feed unguarded every 10
    // minutes after the token later expired or was revoked.
    this.updateCheckInterval = setInterval(() => {
      this.checkForUpdates().catch((err) => {
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

  public async configureAutoUpdater(
    channel: ReleaseChannel,
    triggerImmediateCheck = false,
  ): Promise<void> {
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

      if (triggerImmediateCheck) {
        setTimeout(() => {
          autoUpdater.checkForUpdates().catch((err) => {
            console.error("Startup update check failed:", err);
          });
        }, 2000);
      }
    } else if (channel.type === "pr" && channel.channel) {
      // PR channels are token-gated (#919) — don't configure the autoUpdater feed (and never
      // trigger a background download) unless the token is currently valid.
      const tokenHealth = await this.isGitHubTokenHealthy();
      if (!tokenHealth.healthy) {
        console.warn(
          tokenHealth.noToken
            ? "Skipping PR release channel configuration: no GitHub token configured."
            : "Skipping PR release channel configuration: GitHub token is invalid.",
        );
        // Still (re)start the periodic timer (review on #919): the timer itself re-checks token
        // health via checkForUpdates() every tick, so if the token becomes healthy later without
        // another explicit reconfigure call, periodic checks are already running to pick it up
        // rather than staying stopped forever.
        this.startPeriodicUpdateChecks();
        return;
      }

      // For PR channels, we need to find the latest release tag first
      const prNumber = this.extractPRNumberFromChannel(channel.channel);
      if (prNumber) {
        // Get the latest release for this PR
        if (!this.releasesCache || Date.now() - this.releasesCache.fetchedAt > RELEASES_CACHE_TTL) {
          await this.listReleases(true);
        }

        if (this.releasesCache) {
          const prReleases = this.getPRReleases(prNumber);

          if (prReleases.length > 0) {
            const latestRelease = prReleases[0];
            // Explicitly set the channel before configuring feed URL
            autoUpdater.channel = channel.channel;
            autoUpdater.setFeedURL({
              provider: "generic",
              url: `https://github.com/${REPO_OWNER}/${REPO_NAME}/releases/download/${latestRelease.tag_name}`,
              channel: channel.channel,
            });
            autoUpdater.allowPrerelease = true;
            autoUpdater.allowDowngrade = true;

            const currentVersion = app.getVersion();
            const isOnLatest = currentVersion === latestRelease.tag_name;

            if (triggerImmediateCheck && !isOnLatest) {
              setTimeout(() => {
                autoUpdater.checkForUpdates().catch((err) => {
                  console.error("Startup update check failed:", err);
                });
              }, 2000);
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
