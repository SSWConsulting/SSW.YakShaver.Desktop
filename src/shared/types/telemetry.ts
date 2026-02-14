import { z } from "zod";

export const TelemetryConsentStatusSchema = z.enum(["pending", "granted", "denied"]);
export type TelemetryConsentStatus = z.infer<typeof TelemetryConsentStatusSchema>;

export const TelemetrySettingsSchema = z.object({
  consentStatus: TelemetryConsentStatusSchema,
  consentTimestamp: z.number().optional(),
  allowErrorReporting: z.boolean().default(true),
  allowWorkflowTracking: z.boolean().default(true),
  allowUsageMetrics: z.boolean().default(true),
  userId: z.string().optional(),
});

export type TelemetrySettings = z.infer<typeof TelemetrySettingsSchema>;

export const DEFAULT_TELEMETRY_SETTINGS: TelemetrySettings = {
  consentStatus: "pending",
  allowErrorReporting: true,
  allowWorkflowTracking: true,
  allowUsageMetrics: true,
};

export interface TelemetryEvent {
  name: string;
  properties?: Record<string, string | number | boolean>;
  measurements?: Record<string, number>;
}

export interface WorkflowStageEvent {
  workflowId: string;
  stage: string;
  status: "started" | "completed" | "failed" | "skipped";
  duration?: number;
  error?: string;
}

export interface ErrorEvent {
  error: Error;
  context?: string;
  workflowId?: string;
  additionalProperties?: Record<string, string | number | boolean>;
}
