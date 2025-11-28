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

type TargetInfo = {
  targetId: string;
  type: string;
  title?: string;
  url?: string;
};

type RuntimeConsoleAPICalledParams = {
  type: string;
  args?: RemoteObject[];
  timestamp?: number;
  stackTrace?: {
    callFrames?: Array<{
      url?: string;
    }>;
  };
};

type RemoteObject = {
  type?: string;
  value?: unknown;
  description?: string;
};

type LogEntry = {
  level?: string;
  text?: string;
  source?: string;
  url?: string;
  timestamp?: number;
  args?: Array<{ type?: string; value?: unknown; description?: string }>;
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
const MAX_LOG_ENTRIES = 2000;
const PRE_RECORDING_WINDOW_MS = 2 * 60 * 1000;
const COMMAND_TIMEOUT_MS = 5000;

export class ChromeDevtoolsMonitorService {
  private static instance: ChromeDevtoolsMonitorService;

  private chromeProcess?: ChildProcess;
  private captureSocket?: WebSocket;
  private captureMessageId = 0;
  private monitorConnected = false;
  private recordingStartTimestamp?: number;
  private telemetryStartTimestamp = 0;

  private consoleLogs: ChromeConsoleLogEntry[] = [];
  private networkLogs: ChromeNetworkEntry[] = [];
  private networkMap: Map<string, ChromeNetworkEntry> = new Map();
  private latestSnapshot?: ChromeTelemetrySnapshot;

  private sessionTargets = new Map<string, string>();
  private targetSessions = new Map<string, string>();
  private pendingCommands = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void; timeout: NodeJS.Timeout }
  >();

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

    this.telemetryStartTimestamp = Date.now();

    // First try to attach to an already running Chrome instance on the configured port
    if (await this.tryAttachToExistingChrome()) {
      return { success: true, message: "Attached to existing Chrome debugging session." };
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
      this.teardownSocket("Chrome window closed");
      this.sessionTargets.clear();
      this.targetSessions.clear();
      this.recordingStartTimestamp = undefined;
      this.telemetryStartTimestamp = 0;
      this.resetCollections();
      this.latestSnapshot = undefined;
    });

    const [, browserUrl] = await this.resolveCurrentServer();
    if (!browserUrl) {
      return { success: false, message: "Browser URL was not found for chrome-devtools MCP." };
    }

    try {
      await this.waitForDevtoolsEndpoint(browserUrl, 15_000);
      await this.ensureMonitorConnection(true);
      return { success: true };
    } catch (error) {
      console.error("[ChromeMonitor] telemetry connection failed:", error);
      return {
        success: false,
        message: error instanceof Error ? error.message : "Failed to attach DevTools session",
      };
    }
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

    const consoleLogs = this.consoleLogs
      .filter((entry) => entry.timestamp >= cutoff && entry.timestamp <= stopTime)
      .sort((a, b) => a.timestamp - b.timestamp);
    const networkRequests = this.networkLogs
      .filter((entry) => entry.timestamp >= cutoff && entry.timestamp <= stopTime)
      .sort((a, b) => a.timestamp - b.timestamp);

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
        const socket = this.captureSocket;
        if (!socket) {
          reject(new Error("Chrome websocket missing after open"));
          return;
        }
        socket.off("error", handleError);
        socket.on("message", (raw) => this.handleSocketMessage(raw));
        socket.once("close", () => {
          this.monitorConnected = false;
          this.teardownSocket("Connection closed");
          setTimeout(() => {
            this.ensureMonitorConnection(false).catch((error) => {
              console.warn("[ChromeMonitor] failed to reconnect:", error);
            });
          }, 1000);
        });
        socket.once("error", (error) => console.warn("[ChromeMonitor] socket error", error));
        this.captureMessageId = 0;
        this.monitorConnected = true;
        resolve();
      });

      this.captureSocket.once("error", handleError);
    });
  }

  private teardownSocket(reason: string): void {
    this.pendingCommands.forEach(({ reject, timeout }, id) => {
      clearTimeout(timeout);
      reject(new Error(reason));
      this.pendingCommands.delete(id);
    });
    this.pendingCommands.clear();
    this.sessionTargets.clear();
    this.targetSessions.clear();
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

    const wsUrl = await this.resolveBrowserWebSocketUrl(browserUrl);
    if (!wsUrl) {
      throw new Error("Unable to locate Chrome DevTools websocket endpoint.");
    }

    await this.connectToDevtools(wsUrl);
    await this.sendCommand("Target.setDiscoverTargets", { discover: true }).catch(() => {});
    await this.sendCommand("Target.setAutoAttach", {
      autoAttach: true,
      waitForDebuggerOnStart: false,
      flatten: true,
    }).catch(() => {});

    const targets = await this.sendCommand<{ targetInfos: TargetInfo[] }>("Target.getTargets");
    for (const targetInfo of targets.targetInfos ?? []) {
      await this.maybeAttachToTarget(targetInfo);
    }

    if (resetBuffers) {
      this.resetCollections();
      this.latestSnapshot = undefined;
    }
  }

  private async tryAttachToExistingChrome(): Promise<boolean> {
    try {
      const [, browserUrl] = await this.resolveCurrentServer();
      if (!browserUrl) {
        return false;
      }
      await this.waitForDevtoolsEndpoint(browserUrl, 2_000);
      await this.ensureMonitorConnection(true);
      return true;
    } catch (error) {
      console.warn("[ChromeMonitor] attach to existing Chrome failed:", error);
      return false;
    }
  }

  private async resolveBrowserWebSocketUrl(browserUrl: URL): Promise<string | null> {
    try {
      const version = await this.fetchJson<{ webSocketDebuggerUrl?: string }>(
        new URL("/json/version", browserUrl),
      );
      return version.webSocketDebuggerUrl ?? null;
    } catch {
      return null;
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

  private async waitForDevtoolsEndpoint(browserUrl: URL, timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    let lastError: unknown;
    while (Date.now() < deadline) {
      try {
        await this.fetchJson(new URL("/json/version", browserUrl));
        return;
      } catch (error) {
        lastError = error;
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
    throw new Error(
      `Chrome DevTools endpoint not reachable at ${browserUrl.toString()}: ${lastError instanceof Error ? lastError.message : "unknown error"}`,
    );
  }

  private handleSocketMessage(raw: WebSocket.RawData): void {
    let payload: any;
    try {
      payload = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (typeof payload.id === "number") {
      const pending = this.pendingCommands.get(payload.id);
      if (pending) {
        if (payload.error) {
          pending.reject(new Error(payload.error.message ?? "Command failed"));
        } else {
          pending.resolve(payload.result);
        }
      }
      return;
    }

    const method: string | undefined = payload.method;
    const params: unknown = payload.params;
    const sessionId: string | undefined = payload.sessionId;

    if (!method) {
      return;
    }

    if (method === "Target.attachedToTarget") {
      const info = params as { sessionId: string; targetInfo: TargetInfo };
      if (!this.sessionTargets.has(info.sessionId)) {
        this.sessionTargets.set(info.sessionId, info.targetInfo.targetId);
        this.targetSessions.set(info.targetInfo.targetId, info.sessionId);
        void this.initializeSession(info.sessionId);
      }
      return;
    }

    if (method === "Target.detachedFromTarget") {
      this.detachSession((params as { sessionId?: string }).sessionId);
      return;
    }

    if (method === "Target.targetDestroyed") {
      this.detachTarget((params as { targetId?: string }).targetId);
      return;
    }

    if (method === "Target.targetCreated") {
      void this.maybeAttachToTarget((params as { targetInfo: TargetInfo }).targetInfo);
      return;
    }

    if (sessionId) {
      this.handleSessionEvent(sessionId, method, params);
      return;
    }
  }

  private async maybeAttachToTarget(targetInfo: TargetInfo): Promise<void> {
    if (targetInfo.type !== "page") {
      return;
    }

    if (this.targetSessions.has(targetInfo.targetId)) {
      return;
    }

    try {
      const result = await this.sendCommand<{ sessionId: string }>("Target.attachToTarget", {
        targetId: targetInfo.targetId,
        flatten: true,
      });
      this.sessionTargets.set(result.sessionId, targetInfo.targetId);
      this.targetSessions.set(targetInfo.targetId, result.sessionId);
      await this.initializeSession(result.sessionId);
    } catch (error) {
      console.warn("[ChromeMonitor] Failed to attach to target", targetInfo.targetId, error);
    }
  }

  private detachTarget(targetId?: string): void {
    if (!targetId) return;
    const sessionId = this.targetSessions.get(targetId);
    if (sessionId) {
      this.sessionTargets.delete(sessionId);
    }
    this.targetSessions.delete(targetId);
  }

  private detachSession(sessionId?: string): void {
    if (!sessionId) return;
    const targetId = this.sessionTargets.get(sessionId);
    if (targetId) {
      this.targetSessions.delete(targetId);
    }
    this.sessionTargets.delete(sessionId);
  }

  private async initializeSession(sessionId: string): Promise<void> {
    await this.sendCommand("Runtime.enable", undefined, sessionId).catch(() => {});
    await this.sendCommand("Log.enable", undefined, sessionId).catch(() => {});
    await this.sendCommand("Network.enable", undefined, sessionId).catch(() => {});
  }

  private handleSessionEvent(sessionId: string, method: string, params: unknown): void {
    switch (method) {
      case "Runtime.consoleAPICalled":
        this.handleRuntimeConsoleEvent(params as RuntimeConsoleAPICalledParams);
        break;
      case "Log.entryAdded":
        this.handleLogEntry(params as { entry?: LogEntry });
        break;
      case "Network.requestWillBeSent":
        this.handleNetworkRequest(params as RequestWillBeSentParams, sessionId);
        break;
      case "Network.responseReceived":
        this.handleNetworkResponse(params as ResponseReceivedParams, sessionId);
        break;
      case "Network.loadingFinished":
        this.handleNetworkFinished(params as LoadingFinishedParams, sessionId);
        break;
      default:
        break;
    }
  }

  private handleRuntimeConsoleEvent(params: RuntimeConsoleAPICalledParams): void {
    const level = this.mapConsoleLevel(params.type);
    const message =
      params.args?.map((arg) => this.stringifyRemoteObject(arg)).join(" ") ??
      params.type ??
      "log";
    const timestamp = params.timestamp ? params.timestamp * 1000 : Date.now();
    const entry: ChromeConsoleLogEntry = {
      level,
      text: message,
      url: params.stackTrace?.callFrames?.[0]?.url,
      timestamp,
    };
    if (!this.shouldRecordTimestamp(timestamp)) return;
    this.consoleLogs.push(entry);
    if (this.consoleLogs.length > MAX_LOG_ENTRIES) {
      this.consoleLogs = this.consoleLogs.slice(-MAX_LOG_ENTRIES);
    }
    this.emitTelemetry({ kind: "console", entry });
  }

  private handleLogEntry(payload: { entry?: LogEntry }): void {
    if (!payload.entry) return;
    const timestamp = payload.entry.timestamp ? payload.entry.timestamp * 1000 : Date.now();
    if (!this.shouldRecordTimestamp(timestamp)) return;
    const entry: ChromeConsoleLogEntry = {
      level: payload.entry.level ?? "info",
      text: this.normalizeLegacyLogText(payload.entry),
      source: payload.entry.source,
      url: payload.entry.url,
      timestamp,
    };
    this.consoleLogs.push(entry);
    if (this.consoleLogs.length > MAX_LOG_ENTRIES) {
      this.consoleLogs = this.consoleLogs.slice(-MAX_LOG_ENTRIES);
    }
    this.emitTelemetry({ kind: "console", entry });
  }

  private mapConsoleLevel(type: string): string {
    switch (type) {
      case "warning":
        return "warning";
      case "error":
      case "assert":
        return "error";
      case "info":
      case "log":
      default:
        return "info";
    }
  }

  private stringifyRemoteObject(arg: RemoteObject): string {
    if (typeof arg.value === "string") {
      return arg.value;
    }
    if (typeof arg.value === "number" || typeof arg.value === "boolean") {
      return String(arg.value);
    }
    if (arg.description) {
      return arg.description;
    }
    return "[object]";
  }

  private normalizeLegacyLogText(entry: LogEntry): string {
    if (entry.text?.length) return entry.text;
    if (entry.args?.length) {
      return entry.args
        .map((arg: { value?: unknown; description?: string }) =>
          typeof arg.value === "string"
            ? arg.value
            : arg.description ?? JSON.stringify(arg.value ?? ""),
        )
        .join(" ");
    }
    return "console";
  }

  private handleNetworkRequest(params: RequestWillBeSentParams, sessionId: string): void {
    if (!params.requestId) return;
    const key = this.getNetworkKey(sessionId, params.requestId);
    const existing = this.networkMap.get(key);
    const timestamp = Date.now();
    this.networkMap.set(key, {
      url: params.request?.url ?? existing?.url ?? "",
      method: params.request?.method ?? existing?.method ?? "GET",
      resourceType: params.type ?? existing?.resourceType,
      status: existing?.status,
      mimeType: existing?.mimeType,
      encodedDataLength: existing?.encodedDataLength,
      timestamp,
    });
  }

  private handleNetworkResponse(params: ResponseReceivedParams, sessionId: string): void {
    if (!params.requestId) return;
    const key = this.getNetworkKey(sessionId, params.requestId);
    const existing = this.networkMap.get(key);
    if (!existing) return;
    const timestamp = Date.now();
    this.networkMap.set(key, {
      ...existing,
      status: params.response?.status ?? existing.status,
      mimeType: params.response?.mimeType ?? existing.mimeType,
      timestamp,
    });
    this.pushNetworkLog(key);
  }

  private handleNetworkFinished(params: LoadingFinishedParams, sessionId: string): void {
    if (!params.requestId) return;
    const key = this.getNetworkKey(sessionId, params.requestId);
    const existing = this.networkMap.get(key);
    if (!existing) return;
    const timestamp = Date.now();
    this.networkMap.set(key, {
      ...existing,
      encodedDataLength: params.encodedDataLength ?? existing.encodedDataLength,
      timestamp,
    });
    this.pushNetworkLog(key);
  }

  private pushNetworkLog(key: string): void {
    const entry = this.networkMap.get(key);
    if (!entry || !entry.url) {
      return;
    }
    const normalized: ChromeNetworkEntry = { ...entry };
    if (!this.shouldRecordTimestamp(normalized.timestamp)) {
      return;
    }
    this.networkLogs.push(normalized);
    if (this.networkLogs.length > MAX_LOG_ENTRIES) {
      this.networkLogs = this.networkLogs.slice(-MAX_LOG_ENTRIES);
    }
    this.emitTelemetry({ kind: "network", entry: normalized });
  }

  private getNetworkKey(sessionId: string, requestId: string): string {
    return `${sessionId}:${requestId}`;
  }

  private resetCollections(): void {
    this.consoleLogs = [];
    this.networkLogs = [];
    this.networkMap.clear();
  }

  private shouldRecordTimestamp(timestamp: number): boolean {
    if (!this.telemetryStartTimestamp) {
      return true;
    }
    return timestamp >= this.telemetryStartTimestamp;
  }

  private emitTelemetry(event: ChromeTelemetryEvent): void {
    BrowserWindow.getAllWindows()
      .filter((win) => !win.isDestroyed())
      .forEach((win) => {
        win.webContents.send(IPC_CHANNELS.CHROME_MONITOR_TELEMETRY, event);
      });
  }

  private async sendCommand<T = unknown>(
    method: string,
    params?: Record<string, unknown>,
    sessionId?: string,
  ): Promise<T> {
    if (!this.captureSocket || this.captureSocket.readyState !== WebSocket.OPEN) {
      throw new Error("Chrome monitor is not connected.");
    }
    const id = ++this.captureMessageId;
    const payload: Record<string, unknown> = { id, method };
    if (params) payload.params = params;
    if (sessionId) payload.sessionId = sessionId;

    return await new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingCommands.delete(id);
        reject(new Error(`Command ${method} timed out`));
      }, COMMAND_TIMEOUT_MS);
      this.pendingCommands.set(id, {
        resolve: (value: unknown) => {
          clearTimeout(timeout);
          this.pendingCommands.delete(id);
          resolve(value as T);
        },
        reject: (error: Error) => {
          clearTimeout(timeout);
          this.pendingCommands.delete(id);
          reject(error);
        },
        timeout,
      });
      this.captureSocket?.send(JSON.stringify(payload));
    });
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
