import type { OAuthTokens } from "@ai-sdk/mcp";
import { shell } from "electron";
import { config } from "../../config/env";
import type { McpOAuthTokenStorage } from "../storage/mcp-oauth-token-storage";

/**
 * Gets the authorization URL from the .NET backend for an MCP server.
 */
export async function getAuthUrlFromBackend(serverUrl: string, serverId: string): Promise<string> {
  const portalApiUrl = getPortalApiUrl();
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
 * Polls the token storage until tokens are available for a given server ID.
 */
export async function pollForTokens(
  tokenStorage: McpOAuthTokenStorage,
  serverId: string,
  timeoutMs: number = 60000,
): Promise<OAuthTokens> {
  const start = Date.now();
  console.log(`[McpOAuth] Polling for tokens for server ${serverId} (Timeout: ${timeoutMs}ms)`);
  while (Date.now() - start < timeoutMs) {
    const tokens = await tokenStorage.getTokensAsync(serverId);
    if (tokens) {
      console.log(`[McpOAuth] Tokens found for server ${serverId}`);
      return tokens;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  console.error(`[McpOAuth] Timed out waiting for OAuth tokens for server ${serverId}`);
  throw new Error(`Timed out waiting for OAuth tokens for server ${serverId}`);
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
  return pollForTokens(tokenStorage, serverId, timeoutMs);
}

/**
 * Refreshes the OAuth tokens using the .NET backend.
 */
export async function refreshTokenWithBackend(
  serverUrl: string,
  refreshToken: string,
): Promise<OAuthTokens> {
  const portalApiUrl = getPortalApiUrl();
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

function getPortalApiUrl(): string {
  return config.portalApi().replace(/\/+$/, "");
}
