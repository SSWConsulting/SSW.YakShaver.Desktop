import { experimental_createMCPClient, type experimental_MCPClient, auth } from "@ai-sdk/mcp";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { formatErrorMessage } from "../../utils/error-utils";
import { MCPUtils } from "./mcp-utils";
import type { MCPServerConfig } from "./types";
import { shell } from "electron";
import type {
  OAuthClientProvider,
  OAuthClientInformation,
  OAuthClientMetadata,
  OAuthTokens,
} from "@ai-sdk/mcp";
import { createServer } from "node:http";
import { exec } from "node:child_process";
import "dotenv/config";

export interface CreateClientOptions {
  inMemoryClientTransport?: InMemoryTransport;
}

// Minimal tool interface based on MCP spec; allows additional provider-specific fields.
export interface MCPTool {
  name: string;
  description?: string;
  input_schema?: unknown;
  // Allow arbitrary extra metadata without forcing any.
  [key: string]: unknown;
}

// A tool set can be an array or an object keyed by tool name.
export type MCPToolSet = MCPTool[] | Record<string, MCPTool>;

export class MCPServerClient {
  public mcpClientName: string;
  private mcpClient: experimental_MCPClient;

  private constructor(name: string, client: experimental_MCPClient) {
    this.mcpClientName = name;
    this.mcpClient = client;
  }

  public static async createClientAsync(
    mcpConfig: MCPServerConfig,
    options: CreateClientOptions = {},
  ): Promise<MCPServerClient> {
    // create streamableHttp transport MCP client
    if (mcpConfig.transport === "streamableHttp") {
      const serverUrl = MCPUtils.expandHomePath(mcpConfig.url);

      // Don't use OAuth for built-in MCP server
      if (mcpConfig.builtin) {
        const client = await experimental_createMCPClient({
          transport: {
            type: "http",
            url: serverUrl,
            headers: mcpConfig.headers,
          },
        });
        return new MCPServerClient(mcpConfig.name, client);
      }

      // Currently support OAuth for GitHub MCP server
      if (mcpConfig.url.includes("https://api.githubcopilot.com/mcp")) {
        const githubClientId = process.env.GITHUB_MCP_CLIENT_ID;
        const githubClientSecret = process.env.GITHUB_MCP_CLIENT_SECRET;
        const callbackPort = Number(process.env.MCP_CALLBACK_PORT ?? 8090);

        if (githubClientId && githubClientSecret) {
          const authProvider = new InMemoryOAuthClientProvider({
            clientId: githubClientId,
            clientSecret: githubClientSecret,
            callbackPort,
          });
          await authorizeWithPkceOnce(authProvider, serverUrl, () =>
            waitForAuthorizationCode(callbackPort),
          );
          const client = await experimental_createMCPClient({
            transport: {
              type: "http",
              url: serverUrl,
              authProvider,
            },
          });
          return new MCPServerClient(mcpConfig.name, client);
        }
      }

      // Fallback: Use headers if no OAuth is configured
      const client = await experimental_createMCPClient({
        transport: {
          type: "http",
          url: serverUrl,
          headers: mcpConfig.headers,
        },
      });
      return new MCPServerClient(mcpConfig.name, client);
    }

    // create stdio transport MCP client
    if (mcpConfig.transport === "stdio") {
      if (!mcpConfig.command?.trim()) {
        throw new Error(
          "Unsupported transport configuration: 'command' is required for stdio transports",
        );
      }
      const command = MCPUtils.sanitizeSegment(mcpConfig.command);
      const args = mcpConfig.args
        ?.map((arg) => MCPUtils.sanitizeSegment(arg))
        .filter((arg) => arg.length > 0);
      const cwd = mcpConfig.cwd ? MCPUtils.expandHomePath(mcpConfig.cwd) : undefined;
      const mcpClient = await experimental_createMCPClient({
        transport: new StdioClientTransport({
          command,
          args,
          env: mcpConfig.env,
          stderr: mcpConfig.stderr,
          cwd,
        }),
      });
      return new MCPServerClient(mcpConfig.name, mcpClient);
    }

    // create inMemory transport MCP client
    if (mcpConfig.transport === "inMemory") {
      const clientTransport = options.inMemoryClientTransport;
      if (!clientTransport) {
        throw new Error(
          `Missing in-memory transport for MCP server '${mcpConfig.name}'. Ensure it is registered before use.`,
        );
      }
      const client = await experimental_createMCPClient({
        transport: clientTransport,
      });
      return new MCPServerClient(mcpConfig.name, client);
    }

    throw new Error(`Unsupported transport type: ${mcpConfig}`);
  }

  public async listToolsAsync(): Promise<MCPToolSet> {
    const raw = await this.mcpClient.tools();
    return raw as MCPToolSet;
  }

  public async toolCountAsync(): Promise<number> {
    try {
      const tools = await this.listToolsAsync();
      if (Array.isArray(tools)) {
        return tools.length;
      } else {
        return Object.keys(tools).length;
      }
    } catch (error) {
      throw new Error(
        `Failed to get tool count from MCP server: ${this.mcpClientName}. Error: ${formatErrorMessage(error)}`,
      );
    }
  }

  public async healthCheckAsync(): Promise<{ healthy: boolean; toolCount: number }> {
    try {
      const toolCount = await this.toolCountAsync();
      return { healthy: true, toolCount: toolCount };
    } catch {
      return { healthy: false, toolCount: 0 };
    }
  }

  public async disconnectAsync(): Promise<void> {
    await this.mcpClient.close();
  }
}

class InMemoryOAuthClientProvider implements OAuthClientProvider {
  private _tokens?: OAuthTokens;
  private _codeVerifier?: string;
  private _clientInformation?: OAuthClientInformation;
  private _redirectUrl: string | URL;
  private _clientId: string;
  private _clientSecret?: string;

  constructor(opts: { clientId: string; clientSecret?: string; callbackPort: number }) {
    this._clientId = opts.clientId;
    this._clientSecret = opts.clientSecret;
    this._redirectUrl = `http://localhost:${opts.callbackPort}/callback`;
    this._clientInformation = {
      client_id: this._clientId,
    } as OAuthClientInformation;
    if (this._clientSecret) {
      (this._clientInformation as any).client_secret = this._clientSecret;
      (this._clientInformation as any).token_endpoint_auth_method = "client_secret_post";
    } else {
      (this._clientInformation as any).token_endpoint_auth_method = "none";
    }
  }

  async tokens(): Promise<OAuthTokens | undefined> {
    return this._tokens;
  }
  async saveTokens(tokens: OAuthTokens): Promise<void> {
    this._tokens = tokens;
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
      exec(cmd, () => {});
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
    return {
      client_name: "YakShaver MCP OAuth",
      redirect_uris: [String(this._redirectUrl)],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: this._clientSecret ? "client_secret_post" : "none",
    };
  }
  async clientInformation(): Promise<OAuthClientInformation | undefined> {
    return this._clientInformation;
  }
  async saveClientInformation(info: OAuthClientInformation): Promise<void> {
    this._clientInformation = info;
  }
  addClientAuthentication = async (
    headers: Headers,
    params: URLSearchParams,
    _url: string | URL,
  ): Promise<void> => {
    const info = this._clientInformation;
    if (!info) return;
    const method = (info as any).token_endpoint_auth_method as
      | "client_secret_post"
      | "client_secret_basic"
      | "none"
      | undefined;
    const hasSecret = Boolean((info as any).client_secret);
    const clientId = info.client_id;
    const clientSecret = (info as any).client_secret as string | undefined;
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
    if (scope === "all" || scope === "tokens") this._tokens = undefined;
    if (scope === "all" || scope === "client") this._clientInformation = undefined;
    if (scope === "all" || scope === "verifier") this._codeVerifier = undefined;
  }
}

async function authorizeWithPkceOnce(
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

function waitForAuthorizationCode(port: number): Promise<string> {
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
    server.on("error", (err: any) => {
      if (err?.code === "EADDRINUSE") {
        reject(new Error(`OAuth callback port ${port} is already in use`));
      } else {
        reject(err);
      }
    });
    server.listen(port);
  });
}
