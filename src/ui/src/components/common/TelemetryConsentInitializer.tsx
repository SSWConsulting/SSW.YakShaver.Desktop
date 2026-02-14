import { useEffect, useState } from "react";
import { toast } from "sonner";
import { TelemetryConsentDialog } from "@/components/settings/telemetry";
import { ipcClient } from "@/services/ipc-client";
import { formatErrorMessage } from "@/utils";

interface TelemetryConsentInitializerProps {
  children: React.ReactNode;
}

export function TelemetryConsentInitializer({ children }: TelemetryConsentInitializerProps) {
  const [showConsentDialog, setShowConsentDialog] = useState(false);
  const [isChecking, setIsChecking] = useState(true);

  useEffect(() => {
    const checkConsentStatus = async () => {
      try {
        const result = await ipcClient.telemetry.getConsentStatus();

        if (result.success && result.data) {
          const { hasMadeDecision } = result.data;

          if (!hasMadeDecision) {
            // Delay showing the dialog slightly to let the app fully load
            setTimeout(() => {
              setShowConsentDialog(true);
            }, 2000);
          }
        }
      } catch (error) {
        console.error("Failed to check telemetry consent status:", error);
      } finally {
        setIsChecking(false);
      }
    };

    checkConsentStatus();
  }, []);

  const handleAcceptConsent = async (options: {
    allowErrorReporting: boolean;
    allowWorkflowTracking: boolean;
    allowUsageMetrics: boolean;
    anonymizeData: boolean;
  }) => {
    try {
      // Generate an anonymous user ID
      const userId = `user_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

      const consentResult = await ipcClient.telemetry.requestConsent({
        granted: true,
        userId,
      });

      if (consentResult.success) {
        const settingsResult = await ipcClient.telemetry.updateSettings({
          allowErrorReporting: options.allowErrorReporting,
          allowWorkflowTracking: options.allowWorkflowTracking,
          allowUsageMetrics: options.allowUsageMetrics,
          anonymizeData: options.anonymizeData,
        });

        if (settingsResult.success) {
          toast.success("Thank you! Telemetry is now enabled");
        }
      }
    } catch (error) {
      toast.error(`Failed to save consent: ${formatErrorMessage(error)}`);
    } finally {
      setShowConsentDialog(false);
    }
  };

  const handleDeclineConsent = async () => {
    try {
      await ipcClient.telemetry.requestConsent({ granted: false });
      toast.success("Telemetry has been disabled");
    } catch (error) {
      toast.error(`Failed to save preference: ${formatErrorMessage(error)}`);
    } finally {
      setShowConsentDialog(false);
    }
  };

  if (isChecking) {
    return <>{children}</>;
  }

  return (
    <>
      {children}
      <TelemetryConsentDialog
        open={showConsentDialog}
        onOpenChange={setShowConsentDialog}
        onAccept={handleAcceptConsent}
        onDecline={handleDeclineConsent}
      />
    </>
  );
}
