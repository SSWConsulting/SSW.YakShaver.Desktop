// Used Vercel AI Example for OAuth: https://github.com/vercel/ai/tree/main/examples/mcp/src/mcp-with-auth
import { exec } from "node:child_process";
import type {
  OAuthClientInformation,
  OAuthClientMetadata,
  OAuthClientProvider,
  OAuthTokens,
} from "@ai-sdk/mcp";
import { shell } from "electron";
import { config } from "../../config/env";
import type { McpOAuthTokenStorage } from "../storage/mcp-oauth-token-storage";

type TokenEndpointAuthMethod = "client_secret_post" | "client_secret_basic" | "none";

type ClientInfoInternal = OAuthClientInformation & {
  client_secret?: string;
  token_endpoint_auth_method?: TokenEndpointAuthMethod;
};

export class PersistedOAuthClientProvider implements OAuthClientProvider {
  private _tokens?: OAuthTokens;
  private _codeVerifier?: string;
  private _clientInformation?: OAuthClientInformation;
  private _redirectUrl: string | URL;
  private _tokenStorage?: McpOAuthTokenStorage;
  private _tokenKey?: string;

  constructor(opts: {
    tokenStorage?: McpOAuthTokenStorage;
    tokenKey?: string;
  }) {
    this._tokenStorage = opts.tokenStorage;
    this._tokenKey = opts.tokenKey;
    this._redirectUrl = ""; // Not used for backend flow
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

  async redirectToAuthorization(authorizationUrl: URL): Promise<void> {
    const url = authorizationUrl.toString();
    try {
      await shell.openExternal(url);
    } catch {
      const cmd =
        process.platform === "win32"
          ? `start "" "${url}"`
          : process.platform === "darwin"
            ? `open "${url}"`
            : `xdg-open "${url}"`;
      exec(cmd, (error) => {
        if (error) {
          console.error("Open this URL to continue:", url);
        }
      });
    }
  }

  async saveCodeVerifier(codeVerifier: string): Promise<void> {
    this._codeVerifier = codeVerifier;
  }

  async codeVerifier(): Promise<string> {
    if (!this._codeVerifier) throw new Error("No code verifier saved");
    return this._codeVerifier;
  }

  get redirectUrl(): string | URL {
    return this._redirectUrl;
  }

  get clientMetadata(): OAuthClientMetadata {
    const info = this._clientInformation as ClientInfoInternal | undefined;
    const hasSecret = Boolean(info?.client_secret);

    return {
      client_name: "YakShaver MCP OAuth",
      redirect_uris: [String(this._redirectUrl)],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: hasSecret ? "client_secret_post" : "none",
    };
  }

  async clientInformation(): Promise<OAuthClientInformation | undefined> {
    return this._clientInformation;
  }

  async saveClientInformation(info: OAuthClientInformation): Promise<void> {
    if (this._clientInformation) {
      // Non-dynamic registration: merge server info with existing credentials
      this._clientInformation = { ...this._clientInformation, ...info };
    } else {
      // Dynamic registration: accept server-provided credentials
      this._clientInformation = info;
    }
  }

  addClientAuthentication = async (
    headers: Headers,
    params: URLSearchParams,
    _url: string | URL,
  ): Promise<void> => {
    const info = this._clientInformation;
    if (!info) return;

    const internal = info as ClientInfoInternal;
    const method = internal.token_endpoint_auth_method;
    const hasSecret = Boolean(internal.client_secret);
    const clientId = info.client_id;
    const clientSecret = internal.client_secret;
    const chosen = method ?? (hasSecret ? "client_secret_post" : "none");
    if (chosen === "client_secret_basic") {
      if (!clientSecret) {
        params.set("client_id", clientId);
        return;
      }
      const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
      headers.set("Authorization", `Basic ${credentials}`);
      return;
    }
    if (chosen === "client_secret_post") {
      params.set("client_id", clientId);
      if (clientSecret) params.set("client_secret", clientSecret);
      return;
    }
    params.set("client_id", clientId);
  };

  async invalidateCredentials(scope: "all" | "client" | "tokens" | "verifier") {
    if (scope === "all" || scope === "tokens") {
      this._tokens = undefined;
      if (this._tokenStorage && this._tokenKey) {
        await this._tokenStorage.clearTokensAsync(this._tokenKey);
      }
    }
    if (scope === "all" || scope === "client") this._clientInformation = undefined;
    if (scope === "all" || scope === "verifier") this._codeVerifier = undefined;
  }
}

/**
  * Gets the authorization URL from the .NET backend for an MCP server.
  */
export async function getAuthUrlFromBackend(
  serverUrl: string,
  serverId: string,
): Promise<string> {
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
    throw new Error(`Failed to connect to backend at ${url.toString()}. Ensure the backend is running and SSL certificates are trusted.`);
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
