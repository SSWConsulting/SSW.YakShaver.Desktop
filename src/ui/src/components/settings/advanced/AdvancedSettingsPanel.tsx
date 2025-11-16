import { useState } from "react";
import { toast } from "sonner";
import { useAdvancedSettings } from "@/contexts/AdvancedSettingsContext";
import { formatErrorMessage } from "@/utils";
import { Label } from "../../ui/label";
import { Switch } from "../../ui/switch";

export function AdvancedSettingsPanel() {
  const { settings, isLoading, updateSettings } = useAdvancedSettings();
  const [isSaving, setIsSaving] = useState(false);

  const handleToggle = async (checked: boolean) => {
    setIsSaving(true);
    try {
      await updateSettings({ enableYoutubeUrlImport: checked });
      toast.success(
        `YouTube URL import has been ${checked ? "enabled" : "disabled"} for advanced workflows.`,
      );
    } catch (error) {
      toast.error(`Failed to update advanced settings: ${formatErrorMessage(error)}`);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <section className="p-4 bg-white/5 border border-white/10 rounded-lg flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <Label className="text-white text-base">YouTube URL workflow</Label>
          <p className="text-sm text-white/60">
            Allow entering a YouTube URL instead of recording a video. YakShaver will download and
            process it with the same workflow.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Switch
            id="enable-youtube-url-import"
            checked={settings.enableYoutubeUrlImport}
            disabled={isLoading || isSaving}
            onCheckedChange={handleToggle}
          />
          <label htmlFor="enable-youtube-url-import" className="text-sm text-white/80">
            {settings.enableYoutubeUrlImport ? "Enabled" : "Disabled"}
          </label>
        </div>
      </section>
    </div>
  );
}

