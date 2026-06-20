import { randomBytes, timingSafeEqual } from "node:crypto";
import { promises as fs } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { dirname, join } from "node:path";
import { app } from "electron";
import {
  CLI_BRIDGE_DEFAULT_PORT,
  CLI_BRIDGE_DISABLE_ENV,
  CLI_BRIDGE_HOST,
  CLI_BRIDGE_TOKEN_DIR,
  CLI_BRIDGE_TOKEN_FILE,
  type CliBridgeTokenFile,
} from "../../../shared/cli-bridge/protocol";
import { MCPServerManager } from "../mcp/mcp-server-manager";
import { LlmStorage } from "../storage/llm-storage";
import { UserSettingsStorage } from "../storage/user-settings-storage";
import { type BridgeServices, routeRequest } from "./bridge-router";

const MAX_BODY_BYTES = 256 * 1024; // 256 KB is plenty for config payloads.

/**
 * Localhost-only HTTP bridge that lets the `yakshaver` CLI read and mutate the
 * desktop app's MCP/LLM/settings configuration.
 *
 * Security model:
 *  - Binds to 127.0.0.1 ONLY (never 0.0.0.0), so it is unreachable off-box.
 *  - A random 256-bit token is generated at startup and written, alongside the
 *    chosen port, to `userData/yakshaver-tokens/cli-bridge.json` (same-user
 *    readable). Every request must present `Authorization: Bearer <token>`.
 *  - Secrets (api keys, header/env values) are redacted in every response.
 *  - Opt-out via the YAKSHAVER_DISABLE_CLI_BRIDGE env var.
 */
export class CliBridgeServer {
  private static instance: CliBridgeServer | null = null;

  private server: Server | null = null;
  private token: string | null = null;
  private port: number | null = null;

  private constructor(private readonly services: BridgeServices) {}

  static getInstance(services?: BridgeServices): CliBridgeServer {
    if (!CliBridgeServer.instance) {
      CliBridgeServer.instance = new CliBridgeServer(services ?? createDefaultServices());
    }
    return CliBridgeServer.instance;
  }

  /** Resolve the token file path the same way the secure storage does. */
  private static getTokenFilePath(): string {
    return join(app.getPath("userData"), CLI_BRIDGE_TOKEN_DIR, CLI_BRIDGE_TOKEN_FILE);
  }

  /**
   * Start the bridge. Idempotent and best-effort: any failure is logged but
   * never crashes app startup. Returns true if the server is now listening.
   */
  async start(): Promise<boolean> {
    if (process.env[CLI_BRIDGE_DISABLE_ENV]) {
      console.log("[CliBridge] Disabled via env; not starting.");
      return false;
    }
    if (this.server) {
      return true;
    }

    this.token = randomBytes(32).toString("hex");

    try {
      this.port = await this.listen(CLI_BRIDGE_DEFAULT_PORT);
    } catch (err) {
      console.warn(
        `[CliBridge] Default port ${CLI_BRIDGE_DEFAULT_PORT} unavailable, trying ephemeral port:`,
        err,
      );
      try {
        this.port = await this.listen(0); // OS-assigned ephemeral port.
      } catch (err2) {
        console.error("[CliBridge] Failed to bind localhost bridge:", err2);
        this.server = null;
        return false;
      }
    }

    try {
      await this.writeTokenFile();
    } catch (err) {
      console.error("[CliBridge] Failed to write token file:", err);
      await this.stop();
      return false;
    }

    console.log(`[CliBridge] Listening on http://${CLI_BRIDGE_HOST}:${this.port}`);
    return true;
  }

  private listen(port: number): Promise<number> {
    return new Promise((resolve, reject) => {
      const server = createServer((req, res) => {
        this.handleRequest(req, res).catch((err) => {
          console.error("[CliBridge] Unhandled request error:", err);
          this.sendJson(res, 500, { ok: false, error: "Internal error" });
        });
      });

      server.on("error", reject);
      // Bind to localhost ONLY. Never 0.0.0.0.
      server.listen(port, CLI_BRIDGE_HOST, () => {
        server.removeListener("error", reject);
        this.server = server;
        const address = server.address();
        const boundPort = typeof address === "object" && address ? address.port : port;
        resolve(boundPort);
      });
    });
  }

  private async writeTokenFile(): Promise<void> {
    const filePath = CliBridgeServer.getTokenFilePath();
    await fs.mkdir(dirname(filePath), { recursive: true });

    const payload: CliBridgeTokenFile = {
      port: this.port ?? CLI_BRIDGE_DEFAULT_PORT,
      token: this.token ?? "",
      startedAt: new Date().toISOString(),
      version: safeAppVersion(),
    };

    // Owner-only permissions where the platform honours them (no-op on Windows).
    await fs.writeFile(filePath, JSON.stringify(payload, null, 2), { mode: 0o600 });
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!this.isAuthorized(req)) {
      this.sendJson(res, 401, { ok: false, error: "Unauthorized" });
      return;
    }

    const url = new URL(req.url ?? "/", `http://${CLI_BRIDGE_HOST}`);
    const path = url.pathname;
    const method = req.method ?? "GET";

    let body: unknown;
    try {
      body = await this.readJsonBody(req);
    } catch (err) {
      this.sendJson(res, 400, {
        ok: false,
        error: err instanceof Error ? err.message : "Invalid JSON body",
      });
      return;
    }

    const result = await routeRequest(this.services, { method, path, body });
    this.sendJson(res, result.status, result.body);
  }

  private isAuthorized(req: IncomingMessage): boolean {
    if (!this.token) return false;
    const header = req.headers.authorization ?? "";
    const prefix = "Bearer ";
    if (!header.startsWith(prefix)) return false;
    const provided = header.slice(prefix.length);
    return safeStringEquals(provided, this.token);
  }

  private readJsonBody(req: IncomingMessage): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      let total = 0;
      let settled = false;

      const settleReject = (err: Error) => {
        if (settled) return;
        settled = true;
        // Drain remaining data without buffering so the socket stays usable and
        // the handler can still write an error response (don't destroy it).
        req.removeAllListeners("data");
        req.on("data", () => {});
        reject(err);
      };

      req.on("data", (chunk: Buffer) => {
        total += chunk.length;
        if (total > MAX_BODY_BYTES) {
          settleReject(new Error("Request body too large"));
          return;
        }
        chunks.push(chunk);
      });
      req.on("end", () => {
        if (settled) return;
        settled = true;
        if (chunks.length === 0) {
          resolve(undefined);
          return;
        }
        const raw = Buffer.concat(chunks).toString("utf8").trim();
        if (!raw) {
          resolve(undefined);
          return;
        }
        try {
          resolve(JSON.parse(raw));
        } catch {
          reject(new Error("Invalid JSON body"));
        }
      });
      req.on("error", (err) => settleReject(err instanceof Error ? err : new Error(String(err))));
    });
  }

  private sendJson(res: ServerResponse, status: number, body: unknown): void {
    const payload = JSON.stringify(body);
    res.writeHead(status, {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(payload),
    });
    res.end(payload);
  }

  /** Stop the server and remove the token file. Safe to call multiple times. */
  async stop(): Promise<void> {
    const server = this.server;
    this.server = null;
    this.token = null;

    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }

    try {
      await fs.unlink(CliBridgeServer.getTokenFilePath());
    } catch {
      // Already gone — ignore.
    }
  }

  /** Test/diagnostic helper. */
  getPort(): number | null {
    return this.port;
  }
}

function safeStringEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

function safeAppVersion(): string | undefined {
  try {
    return app.getVersion();
  } catch {
    return undefined;
  }
}

/** Wire the router to the real app singletons. */
function createDefaultServices(): BridgeServices {
  return {
    mcp: {
      async listAvailableServers() {
        const manager = await MCPServerManager.getInstanceAsync();
        return manager.listAvailableServers();
      },
      async addServerAsync(config) {
        const manager = await MCPServerManager.getInstanceAsync();
        return manager.addServerAsync(config);
      },
      async updateServerAsync(serverId, config) {
        const manager = await MCPServerManager.getInstanceAsync();
        return manager.updateServerAsync(serverId, config);
      },
      async removeServerAsync(serverId) {
        const manager = await MCPServerManager.getInstanceAsync();
        return manager.removeServerAsync(serverId);
      },
      async getServerByIdAsync(serverId) {
        return MCPServerManager.getServerConfigByIdAsync(serverId);
      },
    },
    llm: {
      getLLMConfig: () => LlmStorage.getInstance().getLLMConfig(),
      storeLLMConfig: (config) => LlmStorage.getInstance().storeLLMConfig(config),
    },
    settings: {
      getSettingsAsync: () => UserSettingsStorage.getInstance().getSettingsAsync(),
      async updateSettingsAsync(patch) {
        await UserSettingsStorage.getInstance().updateSettingsAsync(patch);
        // Apply the same OS-level side effects the UI/IPC path applies, so a CLI
        // settings change takes effect this session (not only after restart).
        // Mirrors UserSettingsIPCHandlers.handleOpenAtLoginUpdate.
        if (patch.openAtLogin !== undefined) {
          try {
            app.setLoginItemSettings({ openAtLogin: patch.openAtLogin, openAsHidden: false });
          } catch (err) {
            console.warn("[CliBridge] Failed to apply openAtLogin side effect:", err);
          }
        }
      },
    },
  };
}
