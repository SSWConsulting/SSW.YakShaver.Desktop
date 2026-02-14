import { Activity, BarChart3, Bug, CheckCircle, Shield, XCircle } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { useTelemetryConsent } from "@/hooks/useTelemetryConsent";
import { TelemetryConsentDialog } from "./TelemetryConsentDialog";

export function TelemetrySettingsPanel() {
  const {
    settings,
    isLoading,
    hasMadeDecision,
    isEnabled,
    updateSettings,
    grantConsent,
    denyConsent,
  } = useTelemetryConsent();

  const [showConsentDialog, setShowConsentDialog] = useState(false);

  const handleToggleErrorReporting = async (checked: boolean) => {
    if (!isEnabled) {
      toast.error("Please enable telemetry first");
      return;
    }
    await updateSettings({ allowErrorReporting: checked });
  };

  const handleToggleWorkflowTracking = async (checked: boolean) => {
    if (!isEnabled) {
      toast.error("Please enable telemetry first");
      return;
    }
    await updateSettings({ allowWorkflowTracking: checked });
  };

  const handleToggleUsageMetrics = async (checked: boolean) => {
    if (!isEnabled) {
      toast.error("Please enable telemetry first");
      return;
    }
    await updateSettings({ allowUsageMetrics: checked });
  };

  const handleToggleAnonymization = async (checked: boolean) => {
    if (!isEnabled) {
      toast.error("Please enable telemetry first");
      return;
    }
    await updateSettings({ anonymizeData: checked });
  };

  const handleAcceptConsent = async (options: {
    allowErrorReporting: boolean;
    allowWorkflowTracking: boolean;
    allowUsageMetrics: boolean;
    anonymizeData: boolean;
  }) => {
    await grantConsent();
    await updateSettings({
      allowErrorReporting: options.allowErrorReporting,
      allowWorkflowTracking: options.allowWorkflowTracking,
      allowUsageMetrics: options.allowUsageMetrics,
      anonymizeData: options.anonymizeData,
    });
    setShowConsentDialog(false);
  };

  const handleDeclineConsent = async () => {
    await denyConsent();
    setShowConsentDialog(false);
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5" />
            Telemetry & Usage Data
          </CardTitle>
          <CardDescription>Loading settings...</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5" />
            Telemetry & Usage Data
          </CardTitle>
          <CardDescription>
            Control what anonymous usage data is sent to help improve YakShaver
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-6">
          {/* Status Section */}
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-medium">Telemetry Status</h3>
              <p className="text-sm text-muted-foreground">
                {hasMadeDecision
                  ? isEnabled
                    ? "Telemetry is currently enabled"
                    : "Telemetry is currently disabled"
                  : "You haven't made a decision yet"}
              </p>
            </div>
            <Badge variant={isEnabled ? "default" : "secondary"}>
              {isEnabled ? (
                <>
                  <CheckCircle className="h-3 w-3 mr-1" />
                  Enabled
                </>
              ) : (
                <>
                  <XCircle className="h-3 w-3 mr-1" />
                  Disabled
                </>
              )}
            </Badge>
          </div>

          <Separator />

          {/* Consent Button */}
          {!hasMadeDecision || !isEnabled ? (
            <div className="bg-muted/50 p-4 rounded-lg">
              <p className="text-sm mb-3">
                Help us improve YakShaver by sharing anonymous usage data. We never collect personal
                information or video content.
              </p>
              <Button onClick={() => setShowConsentDialog(true)}>Enable Telemetry</Button>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Individual toggles */}
              <div className="space-y-4">
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-3">
                    <Bug className="h-4 w-4 mt-1 text-muted-foreground" />
                    <div>
                      <Label className="text-sm font-medium">Error Reporting</Label>
                      <p className="text-xs text-muted-foreground">
                        Send error reports and stack traces to help us fix bugs
                      </p>
                    </div>
                  </div>
                  <Switch
                    checked={settings?.allowErrorReporting ?? true}
                    onCheckedChange={handleToggleErrorReporting}
                    disabled={!isEnabled}
                  />
                </div>

                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-3">
                    <Activity className="h-4 w-4 mt-1 text-muted-foreground" />
                    <div>
                      <Label className="text-sm font-medium">Workflow Tracking</Label>
                      <p className="text-xs text-muted-foreground">
                        Track processing stage durations (transcription, analysis, etc.)
                      </p>
                    </div>
                  </div>
                  <Switch
                    checked={settings?.allowWorkflowTracking ?? true}
                    onCheckedChange={handleToggleWorkflowTracking}
                    disabled={!isEnabled}
                  />
                </div>

                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-3">
                    <BarChart3 className="h-4 w-4 mt-1 text-muted-foreground" />
                    <div>
                      <Label className="text-sm font-medium">Usage Metrics</Label>
                      <p className="text-xs text-muted-foreground">
                        Feature usage counts and app version information
                      </p>
                    </div>
                  </div>
                  <Switch
                    checked={settings?.allowUsageMetrics ?? true}
                    onCheckedChange={handleToggleUsageMetrics}
                    disabled={!isEnabled}
                  />
                </div>

                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-3">
                    <Shield className="h-4 w-4 mt-1 text-muted-foreground" />
                    <div>
                      <Label className="text-sm font-medium">Anonymize Data</Label>
                      <p className="text-xs text-muted-foreground">
                        Use random IDs instead of identifiable information
                      </p>
                    </div>
                  </div>
                  <Switch
                    checked={settings?.anonymizeData ?? true}
                    onCheckedChange={handleToggleAnonymization}
                    disabled={!isEnabled}
                  />
                </div>
              </div>

              <Separator />

              <Button variant="outline" size="sm" onClick={() => setShowConsentDialog(true)}>
                Update Preferences
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <TelemetryConsentDialog
        open={showConsentDialog}
        onOpenChange={setShowConsentDialog}
        onAccept={handleAcceptConsent}
        onDecline={handleDeclineConsent}
      />
    </>
  );
}
