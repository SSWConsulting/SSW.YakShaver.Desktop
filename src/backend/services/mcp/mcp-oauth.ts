// Used Vercel AI Example for OAuth: https://github.com/vercel/ai/tree/main/examples/mcp/src/mcp-with-auth
import { exec } from "node:child_process";
import { createServer } from "node:http";
import type {
  OAuthClientInformation,
  OAuthClientMetadata,
  OAuthClientProvider,
  OAuthTokens,
} from "@ai-sdk/mcp";
import { auth } from "@ai-sdk/mcp";
import { shell } from "electron";
import { formatErrorMessage } from "../../utils/error-utils";
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
    clientId?: string;
    clientSecret?: string;
    callbackPort: number;
    tokenStorage?: McpOAuthTokenStorage;
    tokenKey?: string;
  }) {
    this._redirectUrl = `http://localhost:${opts.callbackPort}/callback`;
    this._tokenStorage = opts.tokenStorage;
    this._tokenKey = opts.tokenKey;

    if (opts.clientId) {
      this._clientInformation = {
        client_id: opts.clientId,
      } as OAuthClientInformation;

      const info = this._clientInformation as ClientInfoInternal;

      if (opts.clientSecret) {
        info.client_secret = opts.clientSecret;
        info.token_endpoint_auth_method = "client_secret_post";
      } else {
        info.token_endpoint_auth_method = "none";
      }
    }
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

export async function authorizeWithPkceOnce(
  authProvider: OAuthClientProvider,
  serverUrl: string,
  waitForCode: () => Promise<string>,
): Promise<void> {
  const result = await auth(authProvider, { serverUrl: new URL(serverUrl) });
  if (result !== "AUTHORIZED") {
    const authorizationCode = await waitForCode();
    await auth(authProvider, {
      serverUrl: new URL(serverUrl),
      authorizationCode,
    });
  }
}

export function waitForAuthorizationCode(port: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      if (!req.url) {
        res.writeHead(400).end("Bad request");
        return;
      }
      const url = new URL(req.url, `http://localhost:${port}`);
      if (url.pathname !== "/callback") {
        res.writeHead(404).end("Not found");
        return;
      }
      const code = url.searchParams.get("code");
      const err = url.searchParams.get("error");
      if (code) {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(
          "<html><body><h1>Authorization Successful</h1><p>You can close this window.</p></body></html>",
        );
        setTimeout(() => server.close(), 100);
        resolve(code);
      } else {
        res.writeHead(400).end(`Authorization failed: ${err ?? "missing code"}`);
        setTimeout(() => server.close(), 100);
        reject(new Error(`Authorization failed: ${err ?? "missing code"}`));
      }
    });
    server.on("error", (err: NodeJS.ErrnoException) => {
      if (err?.code === "EADDRINUSE") {
        reject(new Error(`OAuth callback port ${port} is already in use`));
      } else {
        reject(err);
      }
    });
    server.listen(port);
  });
}

/**
 * Attempts to discover OAuth endpoints and dynamic client registration support from an MCP server.
 * @returns The OAuth authorization endpoint if dynamic registration is supported, null otherwise
 */
export async function checkDynamicRegistrationSupport(serverUrl: string): Promise<string | null> {
  try {
    const baseUrl = new URL(serverUrl);
    const metadataUrl = new URL("/.well-known/oauth-authorization-server", baseUrl.origin);

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      const metadataResponse = await fetch(metadataUrl.toString(), {
        method: "GET",
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (metadataResponse.ok) {
        const metadata = await metadataResponse.json();

        // Check if dynamic client registration endpoint exists
        if (metadata.registration_endpoint) {
          return metadata.authorization_endpoint;
        }
        return null;
      }
    } catch (metadataError) {
      console.warn(
        `[MCPServerClient]: OAuth metadata endpoint not available at ${metadataUrl}, error: ${formatErrorMessage(metadataError)}`,
      );
    }
    return null;
  } catch (error) {
    console.error(
      `[MCPServerClient]: Error checking dynamic registration support: ${formatErrorMessage(error)}`,
    );
    return null;
  }
}
