import { ipcMain } from "electron";
import { GitHubTokenStorage } from "../services/storage/github-token-storage";
import { formatErrorMessage } from "../utils/error-utils";
import { IPC_CHANNELS } from "./channels";

interface HealthStatusInfo {
  isHealthy: boolean;
  error?: string;
  successMessage?: string;
}

export class GitHubTokenIPCHandlers {
  private store = GitHubTokenStorage.getInstance();

  constructor() {
    ipcMain.handle(IPC_CHANNELS.GITHUB_TOKEN_GET, () => this.getToken());
    ipcMain.handle(IPC_CHANNELS.GITHUB_TOKEN_SET, (_, token: string) =>
      this.setToken(token)
    );
    ipcMain.handle(IPC_CHANNELS.GITHUB_TOKEN_CLEAR, () => this.clearToken());
    ipcMain.handle(IPC_CHANNELS.GITHUB_TOKEN_HAS, () => this.hasToken());
    ipcMain.handle(IPC_CHANNELS.GITHUB_TOKEN_VALIDATE, () =>
      this.validateToken()
    );
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

  private async validateToken(): Promise<HealthStatusInfo> {
    try {
      const token = await this.store.getToken();

      if (!token) {
        return {
          isHealthy: false,
          error: "No token configured",
        };
      }

      const response = await fetch("https://api.github.com/user", {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "User-Agent": "SSW-YakShaver-Desktop",
        },
      });

      if (!response.ok) {
        if (response.status === 401) {
          return {
            isHealthy: false,
            error: "Invalid or expired token",
          };
        }
        if (response.status === 403) {
          const errorBody = await response.text();
          if (/rate limit/i.test(errorBody)) {
            return {
              isHealthy: false,
              error: "Rate limit exceeded",
            };
          }
        }
        return {
          isHealthy: false,
          error: `GitHub API error: ${response.statusText}`,
        };
      }

      const userData = await response.json();
      const username = userData.login || "Unknown";

      return {
        isHealthy: true,
        successMessage: `Valid token for user: ${username}`,
      };
    } catch (error) {
      return {
        isHealthy: false,
        error: formatErrorMessage(error),
      };
    }
  }

  private async verifyToken(): Promise<{
    isValid: boolean;
    username?: string;
    scopes?: string[];
    rateLimitRemaining?: number;
    error?: string;
  }> {
    try {
      const token = await this.store.getToken();
      if (!token) {
        return { isValid: false, error: "No token configured" };
      }

      const response = await fetch("https://api.github.com/user", {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "User-Agent": "SSW-YakShaver-Desktop",
        },
      });

      // Extract scopes and rate limit info from headers even on non-200
      const scopesHeader = response.headers.get("x-oauth-scopes") || "";
      const scopes = scopesHeader
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      const rateLimitRemainingHeader = response.headers.get("x-ratelimit-remaining");
      const rateLimitRemaining = rateLimitRemainingHeader
        ? Number.parseInt(rateLimitRemainingHeader, 10)
        : undefined;

      if (!response.ok) {
        let errorMessage = response.statusText;
        if (response.status === 401) {
          errorMessage = "Invalid or expired token";
        } else if (response.status === 403) {
          const body = await response.text();
          if (/rate limit/i.test(body)) {
            errorMessage = "Rate limit exceeded";
          }
        }
        return {
          isValid: false,
          scopes,
          rateLimitRemaining,
          error: errorMessage,
        };
      }

      const userData = await response.json();
      const username: string | undefined = userData?.login;

      return {
        isValid: true,
        username,
        scopes,
        rateLimitRemaining,
      };
    } catch (error) {
      return { isValid: false, error: formatErrorMessage(error) };
    }
  }
}
