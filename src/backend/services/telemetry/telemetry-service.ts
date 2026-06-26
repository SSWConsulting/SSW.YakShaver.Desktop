import * as appInsights from "applicationinsights";
import { app } from "electron";
import type {
  ErrorEvent,
  TelemetryEvent,
  TelemetrySettings,
  WorkflowStageEvent,
} from "../../../shared/types/telemetry";
import { config } from "../../config/env";
import { TelemetryStorage } from "../storage/telemetry-storage";

export class TelemetryService {
  private static instance: TelemetryService;
  private client: appInsights.TelemetryClient | null = null;
  private storage: TelemetryStorage;
  private settings: TelemetrySettings | null = null;
  private isInitialized = false;

  private constructor() {
    this.storage = TelemetryStorage.getInstance();
  }

  public static getInstance(): TelemetryService {
    if (!TelemetryService.instance) {
      TelemetryService.instance = new TelemetryService();
    }
    return TelemetryService.instance;
  }

  public async initializeAsync(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    try {
      this.settings = await this.storage.getSettingsAsync();

      if (this.settings.consentStatus !== "granted") {
        this.isInitialized = true;
        return;
      }

      this.setupAppInsights();
      this.isInitialized = true;
    } catch (error) {
      console.error("[TelemetryService] Failed to initialize:", error);
      this.isInitialized = true;
    }
  }

  private setupAppInsights(): void {
    const connectionString = config.appInsightsConnectionString();

    if (!connectionString) {
      console.warn(
        "[TelemetryService] APPLICATIONINSIGHTS_CONNECTION_STRING not set. Telemetry disabled.",
      );
      return;
    }

    try {
      appInsights
        .setup(connectionString)
        .setAutoCollectConsole(false)
        .setAutoCollectDependencies(false)
        .setAutoCollectExceptions(true)
        .setAutoCollectHeartbeat(true)
        .setAutoCollectIncomingRequestAzureFunctions(false)
        .setAutoCollectPerformance(true, true)
        .setAutoCollectRequests(false)
        .setAutoDependencyCorrelation(false)
        .setInternalLogging(false, false)
        .setSendLiveMetrics(false)
        .start();

      this.client = appInsights.defaultClient;

      this.client.context.tags[this.client.context.keys.applicationVersion] = app.getVersion();

      if (this.settings?.userId) {
        this.client.context.tags[this.client.context.keys.userId] = this.settings.userId;
      }

      console.log("[TelemetryService] Application Insights initialized successfully");
    } catch (error) {
      console.error("[TelemetryService] Failed to setup Application Insights:", error);
    }
  }

  public async updateSettingsAsync(settings: Partial<TelemetrySettings>): Promise<void> {
    this.settings = await this.storage.updateSettingsAsync(settings);

    if (this.settings.consentStatus === "granted" && !this.client) {
      this.setupAppInsights();
    } else if (this.settings.consentStatus === "denied" && this.client) {
      await this.shutdownAsync();
    }

    if (this.client && this.settings.userId) {
      this.client.context.tags[this.client.context.keys.userId] = this.settings.userId;
    }
  }

  public trackEvent(event: TelemetryEvent): void {
    if (!this.canTrack("usage")) {
      return;
    }

    try {
      this.client?.trackEvent({
        name: event.name,
        properties: this.sanitizeProperties(event.properties),
        measurements: event.measurements,
      });
    } catch (error) {
      console.error("[TelemetryService] Failed to track event:", error);
    }
  }

  public trackWorkflowStage(event: WorkflowStageEvent): void {
    if (!this.canTrack("workflow")) {
      return;
    }

    try {
      const properties: Record<string, string> = {
        workflowId: event.workflowId,
        stage: event.stage,
        status: event.status,
      };

      if (event.error) {
        properties.error = this.truncateString(event.error, 500);
      }

      this.client?.trackEvent({
        name: "WorkflowStage",
        properties,
        measurements: event.duration !== undefined ? { duration: event.duration } : undefined,
      });
    } catch (error) {
      console.error("[TelemetryService] Failed to track workflow stage:", error);
    }
  }

  public trackError(event: ErrorEvent): void {
    if (!this.canTrack("error")) {
      return;
    }

    try {
      const properties: Record<string, string> = {
        context: event.context || "unknown",
      };

      if (event.workflowId) {
        properties.workflowId = event.workflowId;
      }

      if (event.additionalProperties) {
        for (const [key, value] of Object.entries(event.additionalProperties)) {
          if (typeof value === "string") {
            properties[key] = value;
          } else {
            properties[key] = String(value);
          }
        }
      }

      this.client?.trackException({
        exception: event.error,
        properties: this.sanitizeProperties(properties),
      });
    } catch (error) {
      console.error("[TelemetryService] Failed to track error:", error);
    }
  }

  public trackMetric(name: string, value: number, properties?: Record<string, string>): void {
    if (!this.canTrack("usage")) {
      return;
    }

    try {
      this.client?.trackMetric({
        name,
        value,
        properties: this.sanitizeProperties(properties),
      });
    } catch (error) {
      console.error("[TelemetryService] Failed to track metric:", error);
    }
  }

  public async flushAsync(): Promise<void> {
    if (!this.client) {
      return;
    }

    await this.client.flush();
  }

  public async shutdownAsync(): Promise<void> {
    if (this.client) {
      await this.client.flush();
      appInsights.dispose();
      this.client = null;
    }
  }

  public async getSettingsAsync(): Promise<TelemetrySettings> {
    if (!this.settings) {
      this.settings = await this.storage.getSettingsAsync();
    }
    return this.settings;
  }

  public async isTelemetryEnabledAsync(): Promise<boolean> {
    const settings = await this.getSettingsAsync();
    return settings.consentStatus === "granted";
  }

  public async hasUserMadeDecisionAsync(): Promise<boolean> {
    const settings = await this.getSettingsAsync();
    return settings.consentStatus !== "pending";
  }

  private canTrack(type: "error" | "workflow" | "usage"): boolean {
    if (!this.client || !this.settings) {
      return false;
    }

    if (this.settings.consentStatus !== "granted") {
      return false;
    }

    switch (type) {
      case "error":
        return this.settings.allowErrorReporting;
      case "workflow":
        return this.settings.allowWorkflowTracking;
      case "usage":
        return this.settings.allowUsageMetrics;
      default:
        return false;
    }
  }

  private sanitizeProperties(
    properties?: Record<string, string | number | boolean>,
  ): Record<string, string> | undefined {
    if (!properties) {
      return undefined;
    }

    const sanitized: Record<string, string> = {};

    for (const [key, value] of Object.entries(properties)) {
      if (
        key.toLowerCase().includes("token") ||
        key.toLowerCase().includes("password") ||
        key.toLowerCase().includes("secret") ||
        key.toLowerCase().includes("key") ||
        key.toLowerCase().includes("auth")
      ) {
        sanitized[key] = "[REDACTED]";
      } else {
        sanitized[key] = String(value);
      }
    }

    return sanitized;
  }

  private truncateString(str: string, maxLength: number): string {
    if (str.length <= maxLength) {
      return str;
    }
    return `${str.substring(0, maxLength)}...`;
  }
}
