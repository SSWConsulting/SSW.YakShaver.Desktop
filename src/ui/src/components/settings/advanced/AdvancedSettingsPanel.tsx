import { useId } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { useAdvancedSettings } from "@/contexts/AdvancedSettingsContext";

export function AdvancedSettingsPanel() {
  const { isYoutubeUrlWorkflowEnabled, setYoutubeUrlWorkflowEnabled } = useAdvancedSettings();
  const inputId = useId();

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h2 className="text-xl font-semibold">Advanced Settings</h2>
        <p className="text-sm text-muted-foreground">
          Toggle experimental workflows and power-user options. These settings affect how controls
          appear in the main workspace.
        </p>
      </header>

      <Card>
        <CardHeader className="space-y-1">
          <CardTitle>YouTube URL Workflow</CardTitle>
          <CardDescription>
            Adds a dedicated field under the recording controls so you can paste an existing YouTube
            link for processing without recording a new video. Note: Requires Python 3.10+
          </CardDescription>
        </CardHeader>
        <CardContent className="flex items-center justify-between gap-4">
          <Switch
            id={inputId}
            checked={isYoutubeUrlWorkflowEnabled}
            onCheckedChange={setYoutubeUrlWorkflowEnabled}
          />
        </CardContent>
      </Card>
    </div>
  );
}
