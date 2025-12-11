import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { ipcClient } from "@/services/ipc-client";
import type { GeneralSettings, ToolApprovalMode } from "@/types";
import { Card, CardContent } from "../../ui/card";

interface GeneralSettingsPanelProps {
  isActive: boolean;
}

interface ModeOption {
  id: ToolApprovalMode;
  title: string;
  description: string;
}

const MODE_OPTIONS: ModeOption[] = [
  {
    id: "yolo",
    title: "YOLO",
    description:
      "Run every MCP tool immediately. Useful for trusted servers where you accept all actions.",
  },
  {
    id: "wait",
    title: "Wait",
    description:
      "Display tool approval dialog for 15 seconds. If there is no response, the tool call is auto-approved.",
  },
  {
    id: "ask",
    title: "Ask",
    description:
      "Require an explicit decision for every non-whitelisted tool. The workflow pauses indefinitely until you respond.",
  },
];

const MODE_LABELS: Record<ToolApprovalMode, string> = {
  yolo: "YOLO",
  wait: "Wait",
  ask: "Ask",
};

export function GeneralSettingsPanel({ isActive }: GeneralSettingsPanelProps) {
  const [settings, setSettings] = useState<GeneralSettings>({ toolApprovalMode: "ask" });
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [pendingMode, setPendingMode] = useState<ToolApprovalMode | null>(null);

  const loadSettings = useCallback(async () => {
    setIsLoading(true);
    try {
      const current = await ipcClient.generalSettings.get();
      setSettings(current);
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

  const handleModeSelect = useCallback(
    async (mode: ToolApprovalMode) => {
      if (mode === settings.toolApprovalMode) {
        return;
      }
      setPendingMode(mode);
      try {
        await ipcClient.generalSettings.setMode(mode);
        setSettings((prev) => ({ ...prev, toolApprovalMode: mode }));
        toast.success(`${MODE_LABELS[mode]} mode enabled`);
      } catch (error) {
        console.error("Failed to update tool approval mode", error);
        toast.error("Failed to update tool approval mode");
      } finally {
        setPendingMode(null);
      }
    },
    [settings.toolApprovalMode],
  );

  const currentMode = settings.toolApprovalMode;

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h2 className="text-xl font-semibold">Tool Approval Mode</h2>
        <p className="text-sm text-white/70">
          Choose how the orchestrator handles MCP tool approvals.
        </p>
      </div>

      <div className="flex flex-col gap-4 md:flex-row md:items-stretch">
        {MODE_OPTIONS.map((mode) => {
          const isSelected = mode.id === currentMode;
          const isDisabled = isLoading || (!!pendingMode && pendingMode !== mode.id);
          return (
            <Card
              key={mode.id}
              onClick={() => !isDisabled && void handleModeSelect(mode.id)}
              className={cn(
                "transition-all cursor-pointer md:flex-1",
                isSelected
                  ? "border-white/60 bg-white/10 shadow-lg"
                  : "border-white/10 hover:border-white/30 hover:bg-white/5",
                isDisabled && !isSelected && "cursor-not-allowed opacity-60",
              )}
            >
              <CardContent className="px-4 py-4">
                <div className="flex flex-col gap-2">
                  <p className="text-lg font-medium leading-tight">{mode.title}</p>
                  <p className="text-sm text-white/70 leading-relaxed">{mode.description}</p>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
