import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import http from "node:http";
import https from "node:https";
import { BrowserWindow } from "electron";
import WebSocket from "ws";
import { IPC_CHANNELS } from "../../ipc/channels";
import { MCPServerManager } from "../mcp/mcp-server-manager";
import type { MCPServerConfig } from "../mcp/types";

type JsonListEntry = {
  type?: string;
  title?: string;
  url?: string;
  webSocketDebuggerUrl?: string;
};

type LogEntry = {
  level?: string;
  text?: string;
  source?: string;
  url?: string;
  timestamp?: number;
  args?: Array<{ value?: unknown; description?: string }>;
};

type RequestWillBeSentParams = {
  requestId: string;
  request?: {
    url?: string;
    method?: string;
  };
  type?: string;
};

type ResponseReceivedParams = {
  requestId: string;
  response?: {
    status?: number;
    mimeType?: string;
  };
};

type LoadingFinishedParams = {
  requestId: string;
  encodedDataLength?: number;
};

export interface ChromeMonitorState {
  enabled: boolean;
  serverName?: string;
  browserUrl?: string;
  remoteDebuggingPort?: number;
}

export interface ChromeConsoleLogEntry {
  level: string;
  text: string;
  source?: string;
  url?: string;
  timestamp: number;
}

export interface ChromeNetworkEntry {
  url: string;
  method?: string;
  status?: number;
  mimeType?: string;
  resourceType?: string;
  encodedDataLength?: number;
  timestamp: number;
}

export interface ChromeTelemetrySnapshot {
  capturedAt: string;
  serverName: string;
  browserUrl: string;
  consoleLogs: ChromeConsoleLogEntry[];
  networkRequests: ChromeNetworkEntry[];
}

export type ChromeTelemetryEvent =
  | { kind: "console"; entry: ChromeConsoleLogEntry }
  | { kind: "network"; entry: ChromeNetworkEntry };

const CHROME_DEVTOOLS_IDENTIFIER = "chrome-devtools-mcp";
const MAX_LOG_ENTRIES = 1000;
const PRE_RECORDING_WINDOW_MS = 2 * 60 * 1000;

export class ChromeDevtoolsMonitorService {
  private static instance: ChromeDevtoolsMonitorService;

  private chromeProcess?: ChildProcess;
  private captureSocket?: WebSocket;
  private captureMessageId = 0;
  private monitorConnected = false;
  private recordingStartTimestamp?: number;

  private consoleLogs: ChromeConsoleLogEntry[] = [];
  private networkLogs: ChromeNetworkEntry[] = [];
  private networkMap: Map<string, ChromeNetworkEntry> = new Map();
  private latestSnapshot?: ChromeTelemetrySnapshot;

  private constructor() {}

  public static getInstance(): ChromeDevtoolsMonitorService {
    if (!ChromeDevtoolsMonitorService.instance) {
      ChromeDevtoolsMonitorService.instance = new ChromeDevtoolsMonitorService();
    }
    return ChromeDevtoolsMonitorService.instance;
  }

  public async getState(): Promise<ChromeMonitorState> {
    const config = await this.findChromeServerConfig();
    if (!config) {
      return { enabled: false };
    }

    const browserUrl = this.extractBrowserUrl(config);
    if (!browserUrl) {
      return { enabled: false, serverName: config.name };
    }

    return {
      enabled: true,
      serverName: config.name,
      browserUrl: browserUrl.toString(),
      remoteDebuggingPort: this.getRemoteDebuggingPort(browserUrl),
    };
  }

  public getLatestSnapshot(options?: { consume?: boolean }): ChromeTelemetrySnapshot | undefined {
    const snapshot = this.latestSnapshot;
    if (options?.consume && snapshot) {
      this.latestSnapshot = undefined;
    }
    return snapshot;
  }

  public async broadcastState(): Promise<void> {
    const state = await this.getState();
    BrowserWindow.getAllWindows()
      .filter((win) => !win.isDestroyed())
      .forEach((win) => {
        win.webContents.send(IPC_CHANNELS.CHROME_MONITOR_STATE_CHANGED, state);
      });
  }

  public async openMonitoredChrome(): Promise<{ success: boolean; message?: string }> {
    const state = await this.getState();
    if (!state.enabled || !state.remoteDebuggingPort) {
      return { success: false, message: "Chrome MCP test mode is not configured." };
    }

    if (this.chromeProcess && !this.chromeProcess.killed) {
      return { success: true, message: "Monitored Chrome window is already running." };
    }

    const chromePath = this.resolveChromeBinary();
    if (!chromePath) {
      return { success: false, message: "Google Chrome was not found on this system." };
    }

    const profileDir = join(tmpdir(), "yakshaver-chrome-mcp-profile");
    const chromeArgs = [
      "--remote-allow-origins=*",
      `--remote-debugging-port=${state.remoteDebuggingPort}`,
      `--user-data-dir=${profileDir}`,
      "--no-first-run",
      "--disable-default-apps",
      "--disable-popup-blocking",
      "--disable-component-update",
    ];

    try {
      await new Promise<void>((resolve, reject) => {
        this.chromeProcess = spawn(chromePath, chromeArgs, {
          detached: false,
          stdio: "ignore",
        });

        this.chromeProcess.once("spawn", resolve);
        this.chromeProcess.once("error", (error) => {
          this.chromeProcess = undefined;
          reject(error);
        });
      });
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : "Unable to launch Chrome",
      };
    }

    this.chromeProcess?.on("exit", () => {
      this.chromeProcess = undefined;
      this.monitorConnected = false;
      this.captureSocket?.removeAllListeners();
      this.captureSocket = undefined;
      this.recordingStartTimestamp = undefined;
      this.resetCollections();
      this.latestSnapshot = undefined;
    });

    try {
      await this.ensureMonitorConnection(true);
    } catch (error) {
      return {
        success: false,
        message:
          error instanceof Error
            ? error.message
            : "Chrome launched but telemetry connection failed.",
      };
    }

    return { success: true };
  }

  public async startCapture(): Promise<{ success: boolean; message?: string }> {
    const state = await this.getState();
    if (!state.enabled) {
      return { success: false, message: "Chrome MCP test mode is not enabled." };
    }

    try {
      await this.ensureMonitorConnection(false);
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : "Unable to start Chrome monitoring",
      };
    }

    this.recordingStartTimestamp = Date.now();
    this.latestSnapshot = undefined;
    return { success: true };
  }

  public async stopCapture(): Promise<{ success: boolean; message?: string }> {
    if (!this.recordingStartTimestamp) {
      return { success: false, message: "Chrome MCP capture is not active." };
    }

    const startTime = this.recordingStartTimestamp;
    const stopTime = Date.now();
    const cutoff = startTime - PRE_RECORDING_WINDOW_MS;

    const [config, browserUrl] = await this.resolveCurrentServer();

    const consoleLogs = this.consoleLogs.filter(
      (entry) => entry.timestamp >= cutoff && entry.timestamp <= stopTime,
    );
    const networkRequests = this.networkLogs.filter(
      (entry) => entry.timestamp >= cutoff && entry.timestamp <= stopTime,
    );

    this.latestSnapshot = {
      capturedAt: new Date(stopTime).toISOString(),
      serverName: config?.name ?? "chrome-devtools-mcp",
      browserUrl: browserUrl?.toString() ?? "",
      consoleLogs,
      networkRequests,
    };

    this.recordingStartTimestamp = undefined;
    return { success: true };
  }

  private async connectToDevtools(wsUrl: string): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.captureSocket = new WebSocket(wsUrl);

      const handleError = (error?: Error) => {
        this.captureSocket?.removeAllListeners();
        this.captureSocket = undefined;
        reject(error ?? new Error("Failed to connect to Chrome devtools websocket"));
      };

      this.captureSocket.once("open", () => {
        this.captureSocket?.off("error", handleError);
        this.captureSocket?.on("message", (raw) => this.handleSocketMessage(raw));
        this.captureSocket?.on("close", () => {
          this.monitorConnected = false;
          this.captureSocket = undefined;
        });
        this.captureSocket?.on("error", (error) => console.warn("[ChromeMonitor] socket error", error));
        this.captureMessageId = 0;
        this.sendCommand("Log.enable");
        this.sendCommand("Network.enable");
        this.monitorConnected = true;
        resolve();
      });

      this.captureSocket.once("error", handleError);
    });
  }

  private async ensureMonitorConnection(resetBuffers: boolean): Promise<void> {
    if (
      this.monitorConnected &&
      this.captureSocket &&
      this.captureSocket.readyState === WebSocket.OPEN
    ) {
      if (resetBuffers) {
        this.resetCollections();
        this.latestSnapshot = undefined;
      }
      return;
    }

    const [config, browserUrl] = await this.resolveCurrentServer();
    if (!config || !browserUrl) {
      throw new Error("Chrome MCP test mode is not fully configured.");
    }

    const wsUrl = await this.resolveWebSocketUrl(browserUrl);
    await this.connectToDevtools(wsUrl);
    if (resetBuffers) {
      this.resetCollections();
      this.latestSnapshot = undefined;
    }
  }

  private async resolveCurrentServer(): Promise<[MCPServerConfig | null, URL | null]> {
    const config = await this.findChromeServerConfig();
    if (!config) {
      return [null, null];
    }
    const browserUrl = this.extractBrowserUrl(config);
    return [config, browserUrl];
  }

  private handleSocketMessage(raw: WebSocket.RawData): void {
    if (!this.monitorConnected) return;

    let payload: { method?: string; params?: unknown };
    try {
      payload = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (!payload.method || !payload.params) {
      return;
    }

    switch (payload.method) {
      case "Log.entryAdded":
        this.handleConsoleEntry(payload.params as { entry?: LogEntry });
        break;
      case "Network.requestWillBeSent":
        this.handleNetworkRequest(payload.params as RequestWillBeSentParams);
        break;
      case "Network.responseReceived":
        this.handleNetworkResponse(payload.params as ResponseReceivedParams);
        break;
      case "Network.loadingFinished":
        this.handleNetworkFinished(payload.params as LoadingFinishedParams);
        break;
      default:
        break;
    }
  }

  private handleConsoleEntry(payload: { entry?: LogEntry }): void {
    if (!payload.entry) return;
    const entry = payload.entry;
    const timestamp = entry.timestamp ? entry.timestamp * 1000 : Date.now();
    const text = this.normalizeConsoleText(entry);
    const normalized: ChromeConsoleLogEntry = {
      level: entry.level ?? "info",
      text,
      source: entry.source,
      url: entry.url,
      timestamp,
    };
    this.consoleLogs.push(normalized);
    if (this.consoleLogs.length > MAX_LOG_ENTRIES) {
      this.consoleLogs = this.consoleLogs.slice(-MAX_LOG_ENTRIES);
    }
    this.emitTelemetry({ kind: "console", entry: normalized });
  }

  private normalizeConsoleText(entry: LogEntry): string {
    if (entry.text?.length) {
      return entry.text;
    }
    if (entry.args?.length) {
      return entry.args
        .map((arg) =>
          typeof arg.value === "string"
            ? arg.value
            : arg.description ?? JSON.stringify(arg.value ?? ""),
        )
        .join(" ");
    }
    return "(no message)";
  }

  private handleNetworkRequest(params: RequestWillBeSentParams): void {
    if (!params.requestId) return;
    const existing = this.networkMap.get(params.requestId);
    const timestamp = Date.now();
    this.networkMap.set(params.requestId, {
      url: params.request?.url ?? existing?.url ?? "",
      method: params.request?.method ?? existing?.method,
      resourceType: params.type ?? existing?.resourceType,
      status: existing?.status,
      mimeType: existing?.mimeType,
      encodedDataLength: existing?.encodedDataLength,
      timestamp,
    });
    const current = this.networkMap.get(params.requestId);
    if (current) {
      this.networkLogs.push({ ...current });
      if (this.networkLogs.length > MAX_LOG_ENTRIES) {
        this.networkLogs = this.networkLogs.slice(-MAX_LOG_ENTRIES);
      }
      this.emitTelemetry({ kind: "network", entry: { ...current } });
    }
  }

  private handleNetworkResponse(params: ResponseReceivedParams): void {
    if (!params.requestId) return;
    const existing = this.networkMap.get(params.requestId);
    if (!existing) return;
    this.networkMap.set(params.requestId, {
      ...existing,
      status: params.response?.status ?? existing.status,
      mimeType: params.response?.mimeType ?? existing.mimeType,
    });
    const updated = this.networkMap.get(params.requestId);
    if (updated) {
      this.networkLogs.push({ ...updated });
      if (this.networkLogs.length > MAX_LOG_ENTRIES) {
        this.networkLogs = this.networkLogs.slice(-MAX_LOG_ENTRIES);
      }
      this.emitTelemetry({ kind: "network", entry: { ...updated } });
    }
  }

  private handleNetworkFinished(params: LoadingFinishedParams): void {
    if (!params.requestId) return;
    const existing = this.networkMap.get(params.requestId);
    if (!existing) return;
    this.networkMap.set(params.requestId, {
      ...existing,
      encodedDataLength: params.encodedDataLength ?? existing.encodedDataLength,
    });
    const updated = this.networkMap.get(params.requestId);
    if (updated) {
      this.networkLogs.push({ ...updated });
      if (this.networkLogs.length > MAX_LOG_ENTRIES) {
        this.networkLogs = this.networkLogs.slice(-MAX_LOG_ENTRIES);
      }
      this.emitTelemetry({ kind: "network", entry: { ...updated } });
    }
  }

  private resetCollections(): void {
    this.consoleLogs = [];
    this.networkLogs = [];
    this.networkMap.clear();
  }

  private emitTelemetry(event: ChromeTelemetryEvent): void {
    BrowserWindow.getAllWindows()
      .filter((win) => !win.isDestroyed())
      .forEach((win) => {
        win.webContents.send(IPC_CHANNELS.CHROME_MONITOR_TELEMETRY, event);
      });
  }

  private sendCommand(method: string, params?: Record<string, unknown>): void {
    if (!this.captureSocket || this.captureSocket.readyState !== WebSocket.OPEN) {
      return;
    }
    const payload = {
      id: ++this.captureMessageId,
      method,
      params,
    };
    this.captureSocket.send(JSON.stringify(payload));
  }

  private async resolveWebSocketUrl(browserUrl: URL): Promise<string> {
    const listUrl = new URL("/json/list", browserUrl);
    const versionUrl = new URL("/json/version", browserUrl);

    const list = await this.fetchJson<JsonListEntry[]>(listUrl).catch(() => []);
    const page = list.find(
      (entry) => entry.webSocketDebuggerUrl && (entry.type === "page" || entry.type === "other"),
    );
    if (page?.webSocketDebuggerUrl) {
      return page.webSocketDebuggerUrl;
    }

    const version = await this.fetchJson<{ webSocketDebuggerUrl?: string }>(versionUrl);
    if (version.webSocketDebuggerUrl) {
      return version.webSocketDebuggerUrl;
    }

    throw new Error("Unable to locate a debuggable Chrome target");
  }

  private async fetchJson<T>(target: URL): Promise<T> {
    const client = target.protocol === "https:" ? https : http;
    return await new Promise<T>((resolve, reject) => {
      const request = client.request(
        target,
        {
          method: "GET",
        },
        (response) => {
          if (!response.statusCode || response.statusCode >= 400) {
            reject(
              new Error(`Request to ${target.toString()} failed with status ${response.statusCode}`),
            );
            return;
          }

          const chunks: Buffer[] = [];
          response.on("data", (chunk) => chunks.push(chunk));
          response.on("end", () => {
            try {
              const parsed = JSON.parse(Buffer.concat(chunks).toString("utf-8")) as T;
              resolve(parsed);
            } catch (error) {
              reject(error);
            }
          });
        },
      );

      request.on("error", reject);
      request.end();
    });
  }

  private async findChromeServerConfig(): Promise<MCPServerConfig | null> {
    const manager = await MCPServerManager.getInstanceAsync();
    const servers = manager.listAvailableServers();
    return (
      servers.find(
        (server) =>
          server.chromeTestConfig?.enabled &&
          server.transport === "stdio" &&
          this.isChromeDevtoolsServer(server),
      ) ?? null
    );
  }

  private isChromeDevtoolsServer(server: MCPServerConfig): boolean {
    if (server.transport !== "stdio") {
      return false;
    }
    if (this.containsChromeSignature(server.command)) {
      return true;
    }
    return server.args?.some((arg) => this.containsChromeSignature(arg)) ?? false;
  }

  private containsChromeSignature(value?: string): boolean {
    return !!value?.toLowerCase().includes(CHROME_DEVTOOLS_IDENTIFIER);
  }

  private extractBrowserUrl(config: MCPServerConfig): URL | null {
    if (config.transport !== "stdio") {
      return null;
    }
    const argValue = this.findBrowserUrlArg(config.args);
    const envValue = config.env?.BROWSER_URL;
    const raw = argValue ?? envValue;
    if (!raw) {
      return null;
    }

    try {
      return new URL(raw);
    } catch {
      return null;
    }
  }

  private findBrowserUrlArg(args?: string[]): string | undefined {
    if (!args?.length) {
      return undefined;
    }
    for (let index = 0; index < args.length; index++) {
      const current = args[index];
      if (!current) continue;
      if (current.startsWith("--browser-url=")) {
        return current.slice("--browser-url=".length).trim();
      }
      if (current === "--browser-url") {
        return args[index + 1];
      }
    }
    return undefined;
  }

  private getRemoteDebuggingPort(browserUrl: URL): number {
    if (browserUrl.port) {
      return Number(browserUrl.port);
    }
    return browserUrl.protocol === "https:" ? 443 : 9222;
  }

  private resolveChromeBinary(): string | null {
    const platform = process.platform;
    const candidates: string[] = [];
    if (platform === "win32") {
      candidates.push(
        "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
        "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
      );
    } else if (platform === "darwin") {
      candidates.push("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome");
    } else {
      candidates.push(
        "/usr/bin/google-chrome",
        "/usr/bin/google-chrome-stable",
        "/usr/bin/chromium-browser",
        "/usr/bin/chromium",
        "google-chrome",
      );
    }

    for (const candidate of candidates) {
      if (candidate.includes("/") && existsSync(candidate)) {
        return candidate;
      }
      if (!candidate.includes("/")) {
        return candidate;
      }
    }

    return null;
  }
}
