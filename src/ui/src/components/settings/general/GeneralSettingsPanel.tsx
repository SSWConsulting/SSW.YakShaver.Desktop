import { TriangleAlert } from "lucide-react";
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
    id: "ask",
    title: "Ask",
    description:
      "Require an explicit decision for every non-whitelisted tool. The workflow pauses indefinitely until you respond.",
  },
  {
    id: "wait",
    title: "Wait",
    description:
      "Display tool approval dialog for 15 seconds. If there is no response, the tool call is auto-approved.",
  },
  {
    id: "yolo",
    title: "YOLO",
    description:
      "Run every MCP tool immediately. Useful for trusted servers where you accept all actions.",
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
          const isYolo = mode.id === "yolo";
          return (
            <Card
              key={mode.id}
              onClick={() => !isDisabled && void handleModeSelect(mode.id)}
              className={cn(
                "transition-all cursor-pointer md:flex-1",
                isSelected && !isYolo && "border-white/60 bg-white/10 shadow-lg",
                isSelected && isYolo && "border-red-500/60 bg-red-500/10 shadow-lg",
                !isSelected && !isYolo && "border-white/10 hover:border-white/30 hover:bg-white/5",
                !isSelected &&
                  isYolo &&
                  "border-red-500/30 hover:border-red-500/50 hover:bg-red-500/5",
                isDisabled && !isSelected && "cursor-not-allowed opacity-60",
              )}
            >
              <CardContent className="px-4 py-4">
                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-2">
                    <p
                      className={cn("text-lg font-medium leading-tight", isYolo && "text-red-400")}
                    >
                      {mode.title}
                    </p>
                    {isYolo && <TriangleAlert className="h-4 w-4 text-red-400" />}
                  </div>
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
