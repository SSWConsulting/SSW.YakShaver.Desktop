import { type IpcMainInvokeEvent, ipcMain } from "electron";
import type { TelemetrySettings } from "../../shared/types/telemetry";
import { IPC_CHANNELS } from "../ipc/channels";
import { TelemetryService } from "../services/telemetry/telemetry-service";

export class TelemetryIPCHandlers {
  private readonly telemetryService: TelemetryService;

  constructor() {
    this.telemetryService = TelemetryService.getInstance();
    this.registerHandlers();
  }

  private registerHandlers(): void {
    ipcMain.handle(IPC_CHANNELS.TELEMETRY_GET_SETTINGS, async () => {
      try {
        const settings = await this.telemetryService.getSettingsAsync();
        return { success: true, data: settings };
      } catch (error) {
        console.error("[TelemetryIPCHandlers] Failed to get telemetry settings:", error);
        return {
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        };
      }
    });

    ipcMain.handle(
      IPC_CHANNELS.TELEMETRY_UPDATE_SETTINGS,
      async (_event: IpcMainInvokeEvent, settings: Partial<TelemetrySettings>) => {
        try {
          await this.telemetryService.updateSettingsAsync(settings);
          const updatedSettings = await this.telemetryService.getSettingsAsync();
          return { success: true, data: updatedSettings };
        } catch (error) {
          console.error("[TelemetryIPCHandlers] Failed to update telemetry settings:", error);
          return {
            success: false,
            error: error instanceof Error ? error.message : "Unknown error",
          };
        }
      },
    );

    ipcMain.handle(IPC_CHANNELS.TELEMETRY_GET_CONSENT_STATUS, async () => {
      try {
        const hasDecision = await this.telemetryService.hasUserMadeDecisionAsync();
        const isEnabled = await this.telemetryService.isTelemetryEnabledAsync();
        return {
          success: true,
          data: {
            hasMadeDecision: hasDecision,
            isEnabled: isEnabled,
          },
        };
      } catch (error) {
        console.error("[TelemetryIPCHandlers] Failed to get consent status:", error);
        return {
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        };
      }
    });

    ipcMain.handle(
      IPC_CHANNELS.TELEMETRY_REQUEST_CONSENT,
      async (_event: IpcMainInvokeEvent, consent: { granted: boolean; userId?: string }) => {
        try {
          const settings: Partial<TelemetrySettings> = {
            consentStatus: consent.granted ? "granted" : "denied",
            consentTimestamp: Date.now(),
          };

          if (consent.userId) {
            settings.userId = consent.userId;
          }

          await this.telemetryService.updateSettingsAsync(settings);

          return { success: true };
        } catch (error) {
          console.error("[TelemetryIPCHandlers] Failed to save consent:", error);
          return {
            success: false,
            error: error instanceof Error ? error.message : "Unknown error",
          };
        }
      },
    );
  }
}
