import { formatAndReportError } from "../../utils/error-utils";

export interface GitHubTokenVerification {
  isValid: boolean;
  username?: string;
  scopes?: string[];
  rateLimitRemaining?: number;
  error?: string;
}

/**
 * Verify a GitHub personal access token against the GitHub API.
 *
 * Shared by the GitHub Token settings health-check (`GitHubTokenIPCHandlers.verifyToken`) and the
 * release-channel handlers (#919) — PR release channels are token-gated (see
 * `ReleaseChannelIPCHandlers`), so both call sites must agree on what "healthy" means rather than
 * each re-implementing the GitHub API call.
 */
export async function verifyGitHubToken(
  token: string | undefined,
): Promise<GitHubTokenVerification> {
  try {
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
        if (rateLimitRemaining === 0) {
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
    return { isValid: false, error: formatAndReportError(error, "github_token") };
  }
}
