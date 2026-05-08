import { Power } from "lucide-react";
import { useCallback, useEffect, useId, useState } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ipcClient } from "@/services/ipc-client";
import { formatErrorMessage } from "@/utils";

interface StartupSettingProps {
  isActive: boolean;
}

export function StartupSetting({ isActive }: StartupSettingProps) {
  const inputId = useId();
  const [enabled, setEnabled] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSaving, setIsSaving] = useState<boolean>(false);

  useEffect(() => {
    if (!isActive) {
      return;
    }

    let cancelled = false;
    const loadSettings = async () => {
      setIsLoading(true);
      try {
        const current = await ipcClient.userSettings.get();
        if (!cancelled) {
          setEnabled(current.openAtLogin);
        }
      } catch (error) {
        console.error("Failed to load startup setting", error);
        toast.error(`Failed to load startup setting: ${formatErrorMessage(error)}`);
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    void loadSettings();
    return () => {
      cancelled = true;
    };
  }, [isActive]);

  const handleToggle = useCallback(async (checked: boolean) => {
    setIsSaving(true);
    try {
      const result = await ipcClient.userSettings.update({ openAtLogin: checked });
      if (!result.success) {
        throw new Error(result.error ?? "Failed to update startup setting");
      }

      setEnabled(checked);
      toast.success(
        checked
          ? "YakShaver will now start when you sign in"
          : "YakShaver will no longer start automatically",
      );
    } catch (error) {
      console.error("Failed to update startup setting", error);
      toast.error(`Failed to update startup setting: ${formatErrorMessage(error)}`);
    } finally {
      setIsSaving(false);
    }
  }, []);

  return (
    <Card className="w-full gap-4 border-white/10 py-4">
      <CardHeader className="px-4">
        <CardTitle className="flex items-center gap-2">
          <Power className="h-4 w-4" />
          Launch at Login
        </CardTitle>
      </CardHeader>
      <CardContent className="flex items-center justify-between gap-4 px-4">
        <Label htmlFor={inputId} className="cursor-pointer text-sm font-medium">
          Start YakShaver when you sign in to your computer
        </Label>
        <Switch
          id={inputId}
          checked={enabled}
          onCheckedChange={(checked) => void handleToggle(checked)}
          disabled={isLoading || isSaving}
        />
      </CardContent>
    </Card>
  );
}
