import { FlaskConical } from "lucide-react";
import { useId } from "react";
import { Switch } from "@/components/ui/switch";
import { useAdvancedSettings } from "@/contexts/AdvancedSettingsContext";
import { SettingsPageHeader } from "../SettingsPageHeader";
import { SettingsSection } from "../SettingsSection";

export function AdvancedSettingsPanel() {
  const { isYoutubeUrlWorkflowEnabled, setYoutubeUrlWorkflowEnabled } = useAdvancedSettings();
  const inputId = useId();

  return (
    <div className="flex flex-col gap-6">
      <SettingsPageHeader
        icon={FlaskConical}
        title="Advanced Settings"
        description="Toggle experimental workflows and power-user options. These settings affect how controls appear in the main workspace."
      />

      <SettingsSection
        title="YouTube URL Workflow"
        description="Adds an upload button next to the recording controls that opens a dialog where you can paste an existing YouTube link for processing without recording a new video."
        contentClassName="flex items-center justify-between gap-4"
      >
        <Switch
          id={inputId}
          checked={isYoutubeUrlWorkflowEnabled}
          onCheckedChange={setYoutubeUrlWorkflowEnabled}
        />
      </SettingsSection>
    </div>
  );
}
