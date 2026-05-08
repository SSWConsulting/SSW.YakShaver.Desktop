import type { ToolApprovalMode } from "@shared/types/user-settings";
import { DEFAULT_USER_SETTINGS } from "@shared/types/user-settings";
import { TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { ipcClient } from "@/services/ipc-client";
import { formatErrorMessage } from "@/utils";

interface ToolApprovalSettingProps {
  isActive: boolean;
}

interface ModeOption {
  id: ToolApprovalMode;
  title: string;
  description: string;
}

const MODE_OPTIONS: readonly ModeOption[] = [
  {
    id: "ask",
    title: "Ask",
    description: "Pause for your approval before running MCP tools that are not whitelisted.",
  },
  {
    id: "wait",
    title: "Wait",
    description: "Show the approval dialog for 15 seconds, then approve automatically.",
  },
  {
    id: "yolo",
    title: "YOLO",
    description: "Run every MCP tool immediately. Use only with trusted servers.",
  },
];

const MODE_LABELS: Record<ToolApprovalMode, string> = {
  yolo: "YOLO",
  wait: "Wait",
  ask: "Ask",
};

export function ToolApprovalSetting({ isActive }: ToolApprovalSettingProps) {
  const [currentMode, setCurrentMode] = useState<ToolApprovalMode>(
    DEFAULT_USER_SETTINGS.toolApprovalMode,
  );
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [pendingMode, setPendingMode] = useState<ToolApprovalMode | null>(null);

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
          setCurrentMode(current.toolApprovalMode);
        }
      } catch (error) {
        console.error("Failed to load tool approval settings", error);
        toast.error(`Failed to load tool approval settings: ${formatErrorMessage(error)}`);
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

  const handleModeSelect = useCallback(
    async (mode: ToolApprovalMode) => {
      if (mode === currentMode) {
        return;
      }

      setPendingMode(mode);
      try {
        const result = await ipcClient.userSettings.update({ toolApprovalMode: mode });
        if (!result.success) {
          throw new Error(result.error ?? "Failed to update tool approval mode");
        }

        setCurrentMode(mode);
        toast.success(`${MODE_LABELS[mode]} mode enabled`);
      } catch (error) {
        console.error("Failed to update tool approval mode", error);
        toast.error(`Failed to update tool approval mode: ${formatErrorMessage(error)}`);
      } finally {
        setPendingMode(null);
      }
    },
    [currentMode],
  );

  return (
    <Card className="w-full gap-4 border-white/10 py-4">
      <CardHeader className="px-4">
        <CardTitle>Tool Approval</CardTitle>
        <CardDescription>Choose how YakShaver handles MCP tool approval prompts.</CardDescription>
      </CardHeader>

      <CardContent className="px-4">
        <div className="grid gap-2 md:grid-cols-3">
          {MODE_OPTIONS.map((mode) => {
            const isSelected = mode.id === currentMode;
            const isYolo = mode.id === "yolo";
            const isDisabled = isLoading || (!!pendingMode && pendingMode !== mode.id);

            return (
              <button
                key={mode.id}
                type="button"
                onClick={() => void handleModeSelect(mode.id)}
                disabled={isDisabled}
                aria-pressed={isSelected}
                className={cn(
                  "flex h-full flex-col gap-1.5 rounded-md border px-3 py-2 text-left transition-colors",
                  "disabled:cursor-not-allowed disabled:opacity-60",
                  isSelected && !isYolo && "border-white/50 bg-white/10",
                  isSelected && isYolo && "border-red-500/60 bg-red-500/10",
                  !isSelected &&
                    !isYolo &&
                    "border-white/10 hover:border-white/30 hover:bg-white/5",
                  !isSelected &&
                    isYolo &&
                    "border-red-500/30 hover:border-red-500/50 hover:bg-red-500/5",
                )}
              >
                <span className="flex items-center gap-2">
                  <span className={cn("text-sm font-medium", isYolo && "text-red-400")}>
                    {mode.title}
                  </span>
                  {isYolo && <TriangleAlert className="h-4 w-4 text-red-400" />}
                </span>
                <span className="text-xs leading-relaxed text-muted-foreground">
                  {mode.description}
                </span>
              </button>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
