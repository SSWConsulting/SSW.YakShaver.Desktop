import type { OAuthTokens } from "@ai-sdk/mcp";
import { shell } from "electron";
import { config } from "../../config/env";
import { McpOAuthTokenStorage } from "../storage/mcp-oauth-token-storage";

/**
 * Gets the authorization URL from the .NET backend for an MCP server.
 */
export async function getAuthUrlFromBackend(serverUrl: string, serverId: string): Promise<string> {
  const portalApiUrl = config.portalApiUrl();
  const protocol =
    config.azure()?.customProtocol ||
    (config.isDev() ? "yakshaver-desktop-dev" : "yakshaver-desktop");
  const redirectUri = `${protocol}://oauth/callback?serverId=${encodeURIComponent(serverId)}`;
  const endpoint = "/mcp/auth/start";
  const url = new URL(`${portalApiUrl}${endpoint}`);
  url.searchParams.set("serverUrl", serverUrl);
  url.searchParams.set("redirectUri", redirectUri);

  let response: Response;
  try {
    response = await fetch(url.toString(), {
      method: "GET",
      headers: { Accept: "application/json" },
    });
  } catch (fetchError) {
    console.error(`[McpOAuth] Fetch failed for ${url.toString()}:`, fetchError);
    throw new Error(
      `Failed to connect to backend at ${url.toString()}. Ensure the backend is running and SSL certificates are trusted.`,
    );
  }

  if (!response.ok) {
    let errorMessage = "Failed to get authorization URL from backend";
    try {
      const errorData = await response.json();
      errorMessage = errorData.error || errorMessage;
    } catch {
      errorMessage = `${errorMessage} (Status: ${response.status})`;
    }
    throw new Error(errorMessage);
  }

  const data = await response.json();
  return data.authorizationUrl;
}

/**
 * Waits for tokens to be available for a given server ID using an event-driven approach.
 */
export async function waitForTokens(
  tokenStorage: McpOAuthTokenStorage,
  serverId: string,
  timeoutMs: number = 60000,
): Promise<OAuthTokens> {
  // 1. Check immediately if tokens are already there
  const existingTokens = await tokenStorage.getTokensAsync(serverId);
  if (existingTokens) {
    console.log(`[McpOAuth] Tokens already present for server ${serverId}`);
    return existingTokens;
  }

  console.log(`[McpOAuth] Waiting for tokens for server ${serverId} (Timeout: ${timeoutMs}ms)...`);

  return new Promise((resolve, reject) => {
    let timeoutId: NodeJS.Timeout;

    const cleanup = () => {
      clearTimeout(timeoutId);
      tokenStorage.off(McpOAuthTokenStorage.TOKENS_UPDATED_EVENT, onTokensUpdated);
    };

    const onTokensUpdated = async (updatedServerId: string) => {
      if (updatedServerId === serverId) {
        console.log(`[McpOAuth] Received tokens-updated event for server ${serverId}`);
        const tokens = await tokenStorage.getTokensAsync(serverId);
        if (tokens) {
          cleanup();
          resolve(tokens);
        }
      }
    };

    tokenStorage.on(McpOAuthTokenStorage.TOKENS_UPDATED_EVENT, onTokensUpdated);

    timeoutId = setTimeout(() => {
      cleanup();
      console.error(`[McpOAuth] Timed out waiting for OAuth tokens for server ${serverId}`);
      reject(new Error(`Timed out waiting for OAuth tokens for server ${serverId}`));
    }, timeoutMs);
  });
}

/**
 * Initiates the OAuth flow using the .NET backend.
 */
export async function authorizeWithBackend(
  tokenStorage: McpOAuthTokenStorage,
  serverUrl: string,
  serverId: string,
  timeoutMs: number = 60000,
): Promise<OAuthTokens> {
  const authUrl = await getAuthUrlFromBackend(serverUrl, serverId);
  await shell.openExternal(authUrl);
  return waitForTokens(tokenStorage, serverId, timeoutMs);
}

/**
 * Refreshes the OAuth tokens using the .NET backend.
 */
export async function refreshTokenWithBackend(
  serverUrl: string,
  refreshToken: string,
): Promise<OAuthTokens> {
  const portalApiUrl = config.portalApiUrl();
  const endpoint = "/mcp/auth/refresh";
  const url = `${portalApiUrl}${endpoint}`;

  console.log(`[McpOAuth] Refreshing tokens for ${serverUrl}`);

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      serverUrl,
      refreshToken,
    }),
  });

  if (!response.ok) {
    let errorMessage = "Failed to refresh tokens from backend";
    try {
      const errorData = await response.json();
      errorMessage = errorData.error || errorMessage;
    } catch {
      errorMessage = `${errorMessage} (Status: ${response.status})`;
    }
    throw new Error(errorMessage);
  }

  return await response.json();
}
