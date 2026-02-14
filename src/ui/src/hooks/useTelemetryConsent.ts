import type { TelemetrySettings } from "@shared/types/telemetry";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { ipcClient } from "@/services/ipc-client";
import { formatErrorMessage } from "@/utils";

interface UseTelemetryConsentReturn {
  settings: TelemetrySettings | null;
  isLoading: boolean;
  hasMadeDecision: boolean;
  isEnabled: boolean;
  updateSettings: (settings: Partial<TelemetrySettings>) => Promise<void>;
  grantConsent: () => Promise<void>;
  denyConsent: () => Promise<void>;
  refreshSettings: () => Promise<void>;
}

export function useTelemetryConsent(): UseTelemetryConsentReturn {
  const [settings, setSettings] = useState<TelemetrySettings | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [hasMadeDecision, setHasMadeDecision] = useState(false);
  const [isEnabled, setIsEnabled] = useState(false);

  const refreshSettings = useCallback(async () => {
    try {
      setIsLoading(true);
      const result = await ipcClient.telemetry.getSettings();

      if (result.success && result.data) {
        setSettings(result.data);
        setHasMadeDecision(result.data.consentStatus !== "pending");
        setIsEnabled(result.data.consentStatus === "granted");
      } else {
        toast.error("Failed to load telemetry settings");
      }
    } catch (error) {
      toast.error(`Failed to load telemetry settings: ${formatErrorMessage(error)}`);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const updateSettings = useCallback(async (newSettings: Partial<TelemetrySettings>) => {
    try {
      setIsLoading(true);
      const result = await ipcClient.telemetry.updateSettings(newSettings);

      if (result.success && result.data) {
        setSettings(result.data);
        setHasMadeDecision(result.data.consentStatus !== "pending");
        setIsEnabled(result.data.consentStatus === "granted");
        toast.success("Telemetry settings updated");
      } else {
        toast.error("Failed to update telemetry settings");
      }
    } catch (error) {
      toast.error(`Failed to update telemetry settings: ${formatErrorMessage(error)}`);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const grantConsent = useCallback(async () => {
    try {
      setIsLoading(true);
      // Generate an anonymous user ID if anonymization is enabled
      const userId = `user_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

      const result = await ipcClient.telemetry.requestConsent({
        granted: true,
        userId,
      });

      if (result.success) {
        await refreshSettings();
        toast.success("Thank you! Telemetry is now enabled");
      } else {
        toast.error("Failed to save consent");
      }
    } catch (error) {
      toast.error(`Failed to save consent: ${formatErrorMessage(error)}`);
    } finally {
      setIsLoading(false);
    }
  }, [refreshSettings]);

  const denyConsent = useCallback(async () => {
    try {
      setIsLoading(true);
      const result = await ipcClient.telemetry.requestConsent({
        granted: false,
      });

      if (result.success) {
        await refreshSettings();
        toast.success("Telemetry has been disabled");
      } else {
        toast.error("Failed to save preference");
      }
    } catch (error) {
      toast.error(`Failed to save preference: ${formatErrorMessage(error)}`);
    } finally {
      setIsLoading(false);
    }
  }, [refreshSettings]);

  useEffect(() => {
    refreshSettings();
  }, [refreshSettings]);

  return {
    settings,
    isLoading,
    hasMadeDecision,
    isEnabled,
    updateSettings,
    grantConsent,
    denyConsent,
    refreshSettings,
  };
}
