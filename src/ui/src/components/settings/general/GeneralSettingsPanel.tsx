import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ipcClient } from "@/services/ipc-client";
import type { GeneralSettings, ToolApprovalMode } from "@/types";
import { cn } from "@/lib/utils";
import { Button } from "../../ui/button";

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
    description: "Run every MCP tool immediately. Useful for trusted servers where you accept all actions.",
  },
  {
    id: "wait",
    title: "Wait",
    description:
      "Show the approval dialog for 15 seconds. If there is no response in that window, the tool call is auto-approved.",
  },
  {
    id: "always_ask",
    title: "Always Ask",
    description:
      "Require an explicit decision for every non-whitelisted tool. The workflow pauses indefinitely until you respond.",
  },
];

const MODE_LABELS: Record<ToolApprovalMode, string> = {
  yolo: "YOLO",
  wait: "Wait",
  always_ask: "Always Ask",
};

export function GeneralSettingsPanel({ isActive }: GeneralSettingsPanelProps) {
  const [settings, setSettings] = useState<GeneralSettings>({ toolApprovalMode: "always_ask" });
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

  const helperText = useMemo(() => {
    switch (currentMode) {
      case "yolo":
        return "All tool calls are executed immediately. Only use this with MCP servers you completely trust.";
      case "wait":
        return "You will see the approval dialog, but the tool will run automatically after 15 seconds if you do nothing.";
      default:
        return "You must explicitly approve each non-whitelisted tool. This is the safest option.";
    }
  }, [currentMode]);

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h2 className="text-xl font-semibold">Tool Approval Mode</h2>
        <p className="text-sm text-white/70">
          Choose how the orchestrator handles MCP tool approvals. You can switch modes at any time per your risk tolerance.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {MODE_OPTIONS.map((mode) => {
          const isSelected = mode.id === currentMode;
          return (
            <button
              key={mode.id}
              type="button"
              onClick={() => void handleModeSelect(mode.id)}
              className={cn(
                "w-full text-left p-4 rounded-lg border transition-all",
                isSelected
                  ? "border-white/60 bg-white/10 shadow-lg"
                  : "border-white/10 hover:border-white/30 hover:bg-white/5",
                (isLoading || pendingMode !== null) && !isSelected && "cursor-not-allowed opacity-60",
              )}
              disabled={isLoading || (!!pendingMode && pendingMode !== mode.id)}
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-lg font-medium">{mode.title}</p>
                  <p className="text-sm text-white/70">{mode.description}</p>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      <div className="p-4 rounded-md bg-white/5 border border-white/10">
        <p className="text-sm text-white/80">{helperText}</p>
      </div>

      <div className="flex justify-end">
        <Button
          variant="outline"
          disabled={isLoading}
          onClick={() => void loadSettings()}
        >
          Refresh
        </Button>
      </div>
    </div>
  );
}
