// Used Vercel AI Example for OAuth: https://github.com/vercel/ai/tree/main/examples/mcp/src/mcp-with-auth
import type {
  OAuthClientInformation,
  OAuthClientMetadata,
  OAuthClientProvider,
  OAuthTokens,
} from "@ai-sdk/mcp";
import { shell } from "electron";
import { config } from "../../config/env";
import type { McpOAuthTokenStorage } from "../storage/mcp-oauth-token-storage";

export class PersistedOAuthClientProvider implements OAuthClientProvider {
  private _tokens?: OAuthTokens;
  private _tokenStorage?: McpOAuthTokenStorage;
  private _tokenKey?: string;

  constructor(opts: {
    tokenStorage?: McpOAuthTokenStorage;
    tokenKey?: string;
  }) {
    this._tokenStorage = opts.tokenStorage;
    this._tokenKey = opts.tokenKey;
  }

  async tokens(): Promise<OAuthTokens | undefined> {
    if (this._tokens) return this._tokens;
    if (!this._tokenStorage || !this._tokenKey) return undefined;
    const stored = await this._tokenStorage.getTokensAsync(this._tokenKey);
    this._tokens = stored;
    return stored;
  }

  async saveTokens(tokens: OAuthTokens): Promise<void> {
    this._tokens = tokens;
    if (this._tokenStorage && this._tokenKey) {
      await this._tokenStorage.saveTokensAsync(this._tokenKey, tokens);
    }
  }

  async invalidateCredentials(scope: "all" | "tokens") {
    if (scope === "all" || scope === "tokens") {
      this._tokens = undefined;
      if (this._tokenStorage && this._tokenKey) {
        await this._tokenStorage.clearTokensAsync(this._tokenKey);
      }
    }
  }

  // The following methods are required by the OAuthClientProvider interface
  // but are not used in the backend-delegated OAuth flow.
  get redirectUrl(): string | URL {
    throw new Error("redirectUrl not supported in backend-delegated flow");
  }
  get clientMetadata(): OAuthClientMetadata {
    throw new Error("clientMetadata not supported in backend-delegated flow");
  }
  async clientInformation(): Promise<OAuthClientInformation | undefined> {
    return undefined;
  }
  async saveClientInformation(): Promise<void> {}
  async redirectToAuthorization(): Promise<void> {
    throw new Error("redirectToAuthorization not supported in backend-delegated flow");
  }
  async saveCodeVerifier(): Promise<void> {}
  async codeVerifier(): Promise<string> {
    throw new Error("codeVerifier not supported in backend-delegated flow");
  }
}

/**
 * Gets the authorization URL from the .NET backend for an MCP server.
 */
export async function getAuthUrlFromBackend(serverUrl: string, serverId: string): Promise<string> {
  const portalApiUrl = config.portalApi().replace(/\/+$/, "");
  const redirectUri = `yakshaver-desktop://oauth/callback?serverId=${encodeURIComponent(serverId)}`;
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
  while (Date.now() - start < timeoutMs) {
    const tokens = await tokenStorage.getTokensAsync(serverId);
    if (tokens) return tokens;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`Timed out waiting for OAuth tokens for server ${serverId}`);
}

/**
 * Initiates the OAuth flow using the .NET backend.
 */
export async function authorizeWithBackend(
  tokenStorage: McpOAuthTokenStorage,
  serverUrl: string,
  serverId: string,
  timeoutMs?: number,
): Promise<OAuthTokens> {
  const authUrl = await getAuthUrlFromBackend(serverUrl, serverId);
  await shell.openExternal(authUrl);
  return pollForTokens(tokenStorage, serverId, timeoutMs);
}
