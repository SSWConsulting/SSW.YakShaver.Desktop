import { promises as fs } from "node:fs";
import { join } from "node:path";
import {
  type BridgeResponse,
  CLI_BRIDGE_HOST,
  CLI_BRIDGE_TOKEN_DIR,
  CLI_BRIDGE_TOKEN_FILE,
  type CliBridgeTokenFile,
  CliBridgeTokenFileSchema,
} from "../shared/cli-bridge/protocol";
import { getUserDataDir } from "./user-data-path";

/** Thrown when the app/bridge isn't reachable. The CLI prints a friendly hint. */
export class BridgeUnavailableError extends Error {
  /** True when the token file simply did not exist (vs. corrupt/unreachable). */
  readonly notFound: boolean;

  constructor(message: string, options?: { notFound?: boolean }) {
    super(message);
    this.name = "BridgeUnavailableError";
    this.notFound = options?.notFound ?? false;
  }
}

const NOT_RUNNING_HINT =
  "YakShaver Desktop doesn't appear to be running (or the CLI bridge is disabled). " +
  "Start the app and retry.";

/**
 * Read + validate the token file the app wrote.
 *
 * The desktop app and the CLI are separate processes that do NOT share an env,
 * and they detect "dev" differently (the app keys off NODE_ENV/--dev-protocol;
 * a developer's plain shell has neither). To avoid a misleading "not running"
 * error when the dev app is up but the CLI looked in the prod folder (or vice
 * versa), an UNSPECIFIED `dev` (the default) tries BOTH the prod and the dev
 * token locations before giving up. Passing `dev: true`/`false` explicitly
 * (e.g. via `--dev`) pins the search to that single location.
 */
export async function readTokenFile(dev?: boolean): Promise<CliBridgeTokenFile> {
  // When dev is unspecified, probe both builds (prod first, then dev).
  const candidates: boolean[] = dev === undefined ? [false, true] : [dev];

  let lastError: Error | undefined;
  for (const candidate of candidates) {
    try {
      return await readTokenFileFrom(candidate);
    } catch (err) {
      // Keep probing other locations only when this one simply isn't there.
      if (err instanceof BridgeUnavailableError && err.notFound) {
        lastError = err;
        continue;
      }
      // A present-but-corrupt/invalid file is a real signal — surface it.
      throw err;
    }
  }
  throw lastError ?? new BridgeUnavailableError(NOT_RUNNING_HINT);
}

/** Read + validate the token file from one specific build's userData dir. */
async function readTokenFileFrom(dev: boolean): Promise<CliBridgeTokenFile> {
  const filePath = join(getUserDataDir(dev), CLI_BRIDGE_TOKEN_DIR, CLI_BRIDGE_TOKEN_FILE);

  let raw: string;
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new BridgeUnavailableError(NOT_RUNNING_HINT, { notFound: true });
    }
    throw err;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new BridgeUnavailableError(
      `CLI bridge token file is corrupt (${filePath}). ${NOT_RUNNING_HINT}`,
    );
  }

  const result = CliBridgeTokenFileSchema.safeParse(parsed);
  if (!result.success) {
    throw new BridgeUnavailableError(
      `CLI bridge token file is invalid (${filePath}). ${NOT_RUNNING_HINT}`,
    );
  }
  return result.data;
}

export interface BridgeClientOptions {
  dev?: boolean;
  /** Injectable for testing. Defaults to global fetch. */
  fetchFn?: typeof fetch;
  /** Injectable for testing. Defaults to readTokenFile. */
  tokenLoader?: (dev?: boolean) => Promise<CliBridgeTokenFile>;
}

/** Tiny typed client over the bridge HTTP API. */
export class BridgeClient {
  private readonly fetchFn: typeof fetch;
  private readonly tokenLoader: (dev?: boolean) => Promise<CliBridgeTokenFile>;
  private readonly dev?: boolean;
  private tokenFile: CliBridgeTokenFile | null = null;

  constructor(options: BridgeClientOptions = {}) {
    this.fetchFn = options.fetchFn ?? fetch;
    this.tokenLoader = options.tokenLoader ?? readTokenFile;
    this.dev = options.dev;
  }

  private async ensureToken(): Promise<CliBridgeTokenFile> {
    if (!this.tokenFile) {
      this.tokenFile = await this.tokenLoader(this.dev);
    }
    return this.tokenFile;
  }

  /** Build the absolute URL for a bridge path. */
  async buildUrl(path: string): Promise<string> {
    const { port } = await this.ensureToken();
    const normalized = path.startsWith("/") ? path : `/${path}`;
    return `http://${CLI_BRIDGE_HOST}:${port}${normalized}`;
  }

  async request<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
    const token = await this.ensureToken();
    const url = await this.buildUrl(path);

    let response: Response;
    try {
      response = await this.fetchFn(url, {
        method,
        headers: {
          Authorization: `Bearer ${token.token}`,
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch (err) {
      // Connection refused etc. → app not actually listening.
      throw new BridgeUnavailableError(
        `${NOT_RUNNING_HINT} (${err instanceof Error ? err.message : String(err)})`,
      );
    }

    let payload: BridgeResponse<T>;
    try {
      payload = (await response.json()) as BridgeResponse<T>;
    } catch {
      throw new Error(`Bridge returned a non-JSON response (HTTP ${response.status}).`);
    }

    if (!payload.ok) {
      throw new Error(payload.error || `Request failed (HTTP ${response.status}).`);
    }
    return payload.data;
  }

  get<T = unknown>(path: string): Promise<T> {
    return this.request<T>("GET", path);
  }
  post<T = unknown>(path: string, body?: unknown): Promise<T> {
    return this.request<T>("POST", path, body);
  }
  put<T = unknown>(path: string, body?: unknown): Promise<T> {
    return this.request<T>("PUT", path, body);
  }
  patch<T = unknown>(path: string, body?: unknown): Promise<T> {
    return this.request<T>("PATCH", path, body);
  }
  del<T = unknown>(path: string): Promise<T> {
    return this.request<T>("DELETE", path);
  }
}
