import type { OAuthTokens } from "@ai-sdk/mcp";
import { refreshTokenWithBackend } from "./mcp-oauth";
import { expandHomePath } from "./mcp-utils";

/** The minimal token shape the refresh helper reads — a subset of `StoredOAuthTokens`. */
export interface RefreshableTokens {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  storedAt?: number;
}

/**
 * The token-storage surface the refresh helper needs. `McpOAuthTokenStorage` satisfies it; tests
 * can stub a subset (the refresh hooks are optional, so a bare `getTokensAsync` mock is enough for
 * the no-refresh path). Kept narrow so callers don't have to depend on the full singleton.
 */
export interface RefreshableTokenStorage {
  getTokensAsync(serverId: string): Promise<RefreshableTokens | undefined>;
  saveTokensAsync?(serverId: string, tokens: OAuthTokens): Promise<void>;
  clearTokensAsync?(serverId: string): Promise<void>;
  isTokenExpired?(tokens: RefreshableTokens): boolean;
}

/**
 * Returns a VALID OAuth access token for an MCP server, refreshing it first if it has expired and
 * a refresh token is available (clearing the stored tokens if the refresh fails, so the next run
 * re-authenticates). Shared by `MCPServerClient` (in-process OpenAI path) and
 * `LocalClaudeOrchestrator` (headless Claude path) so both inject the SAME freshness guarantee
 * when building `Authorization: Bearer …` headers — neither hands an MCP server a stale token.
 *
 * Returns `undefined` when there is no usable access token (the caller should fall back to
 * unauthenticated headers, matching prior behaviour).
 */
export async function getFreshAccessTokenAsync(
  storage: RefreshableTokenStorage,
  serverId: string,
  serverUrl: string,
): Promise<string | undefined> {
  let tokens = await storage.getTokensAsync(serverId);

  const canRefresh =
    typeof storage.isTokenExpired === "function" &&
    typeof storage.saveTokensAsync === "function" &&
    typeof storage.clearTokensAsync === "function";

  if (canRefresh && tokens?.refresh_token && storage.isTokenExpired?.(tokens)) {
    try {
      const refreshUrl = expandHomePath(serverUrl);
      const newTokens = await refreshTokenWithBackend(refreshUrl, tokens.refresh_token);
      await storage.saveTokensAsync?.(serverId, newTokens);
      tokens = await storage.getTokensAsync(serverId);
    } catch (refreshError) {
      console.error(`[mcp-token-refresh] Failed to refresh token for ${serverId}:`, refreshError);
      // Clear so the next attempt re-auths instead of reusing a known-bad token.
      await storage.clearTokensAsync?.(serverId);
      tokens = undefined;
    }
  }

  return tokens?.access_token;
}
