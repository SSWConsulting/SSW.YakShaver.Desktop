import { Settings2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { ipcClient } from "@/services/ipc-client";
import { Checkbox } from "../../ui/checkbox";
import { Label } from "../../ui/label";

interface GeneralSettingsPanelProps {
  isActive: boolean;
}

export function GeneralSettingsPanel({ isActive }: GeneralSettingsPanelProps) {
  const [autoLaunchEnabled, setAutoLaunchEnabled] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSaving, setIsSaving] = useState<boolean>(false);

  const loadSettings = useCallback(async () => {
    setIsLoading(true);
    try {
      const current = await ipcClient.userSettings.get();
      setAutoLaunchEnabled(current.openAtLogin);
    } catch (error) {
      console.error("Failed to load general settings", error);
      toast.error("Failed to load general settings");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isActive) {
      return;
    }
    void loadSettings();
  }, [isActive, loadSettings]);

  const handleAutoLaunchToggle = useCallback(async (checked: boolean) => {
    setIsSaving(true);
    try {
      await ipcClient.userSettings.update({ openAtLogin: checked });
      setAutoLaunchEnabled(checked);
      toast.success(
        checked
          ? "YakShaver will now start when you sign in"
          : "YakShaver will no longer start automatically",
      );
    } catch (error) {
      console.error("Failed to update startup setting", error);
      toast.error("Failed to update startup setting");
    } finally {
      setIsSaving(false);
    }
  }, []);

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h2 className="text-xl font-semibold flex items-center gap-2">
          <Settings2 className="h-5 w-5" />
          General
        </h2>
        <p className="text-sm text-white/70">Configure general application settings.</p>
      </div>

      <div className="flex items-center space-x-3">
        <Checkbox
          id="auto-launch"
          checked={autoLaunchEnabled}
          onCheckedChange={handleAutoLaunchToggle}
          disabled={isLoading || isSaving}
        />
        <Label
          htmlFor="auto-launch"
          className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
        >
          Start YakShaver when you sign in to your computer
        </Label>
      </div>
    </div>
  );
}
