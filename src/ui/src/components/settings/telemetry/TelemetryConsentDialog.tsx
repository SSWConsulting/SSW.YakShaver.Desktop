import { Activity, BarChart3, Bug } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";

interface TelemetryConsentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAccept: (options: {
    allowErrorReporting: boolean;
    allowWorkflowTracking: boolean;
    allowUsageMetrics: boolean;
  }) => void;
  onDecline: () => void;
}

export function TelemetryConsentDialog({
  open,
  onOpenChange,
  onAccept,
  onDecline,
}: TelemetryConsentDialogProps) {
  const [allowErrorReporting, setAllowErrorReporting] = useState(true);
  const [allowWorkflowTracking, setAllowWorkflowTracking] = useState(true);
  const [allowUsageMetrics, setAllowUsageMetrics] = useState(true);

  const handleAccept = () => {
    onAccept({
      allowErrorReporting,
      allowWorkflowTracking,
      allowUsageMetrics,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5" />
            Help Us Improve YakShaver
          </DialogTitle>
          <DialogDescription className="pt-2">
            We'd like to collect anonymous usage data to help improve YakShaver. Your privacy is
            important to us - no personal information or video content is ever collected.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-3">
            <h4 className="text-sm font-medium">What we collect:</h4>

            <div className="flex items-start space-x-3">
              <Bug className="h-4 w-4 mt-0.5 text-muted-foreground" />
              <div className="flex-1">
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="error-reporting"
                    checked={allowErrorReporting}
                    onCheckedChange={(checked) => setAllowErrorReporting(checked as boolean)}
                  />
                  <Label htmlFor="error-reporting" className="text-sm">
                    Error reports
                  </Label>
                </div>
                <p className="text-xs text-muted-foreground mt-1 ml-6">
                  Stack traces and error messages to help us fix bugs
                </p>
              </div>
            </div>

            <div className="flex items-start space-x-3">
              <Activity className="h-4 w-4 mt-0.5 text-muted-foreground" />
              <div className="flex-1">
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="workflow-tracking"
                    checked={allowWorkflowTracking}
                    onCheckedChange={(checked) => setAllowWorkflowTracking(checked as boolean)}
                  />
                  <Label htmlFor="workflow-tracking" className="text-sm">
                    Workflow performance
                  </Label>
                </div>
                <p className="text-xs text-muted-foreground mt-1 ml-6">
                  How long processing stages take (transcription, analysis, etc.)
                </p>
              </div>
            </div>

            <div className="flex items-start space-x-3">
              <BarChart3 className="h-4 w-4 mt-0.5 text-muted-foreground" />
              <div className="flex-1">
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="usage-metrics"
                    checked={allowUsageMetrics}
                    onCheckedChange={(checked) => setAllowUsageMetrics(checked as boolean)}
                  />
                  <Label htmlFor="usage-metrics" className="text-sm">
                    Usage metrics
                  </Label>
                </div>
                <p className="text-xs text-muted-foreground mt-1 ml-6">
                  Feature usage counts and app version information
                </p>
              </div>
            </div>
          </div>
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button variant="outline" onClick={onDecline} className="w-full sm:w-auto">
            Decline
          </Button>
          <Button onClick={handleAccept} className="w-full sm:w-auto">
            Accept & Continue
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
