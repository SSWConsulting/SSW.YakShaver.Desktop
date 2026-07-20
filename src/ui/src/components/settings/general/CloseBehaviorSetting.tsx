import type { CloseBehavior } from "@shared/types/user-settings";
import { DEFAULT_USER_SETTINGS } from "@shared/types/user-settings";
import { X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { ipcClient } from "@/services/ipc-client";
import { formatErrorMessage } from "@/utils";
import { SettingsSection } from "../SettingsSection";

interface CloseBehaviorSettingProps {
  isActive: boolean;
}

interface CloseBehaviorOption {
  id: CloseBehavior;
  title: string;
  description: string;
}

const CLOSE_BEHAVIOR_OPTIONS: readonly CloseBehaviorOption[] = [
  {
    id: "minimize-to-tray",
    title: "Minimize to tray",
    description: "Keep YakShaver running in the background and accessible from the tray icon.",
  },
  {
    id: "quit",
    title: "Quit application",
    description: "Fully exit YakShaver and remove the tray icon.",
  },
];

const CLOSE_BEHAVIOR_LABELS: Record<CloseBehavior, string> = {
  "minimize-to-tray": "Minimize to tray",
  quit: "Quit application",
};

export function CloseBehaviorSetting({ isActive }: CloseBehaviorSettingProps) {
  const [currentBehavior, setCurrentBehavior] = useState<CloseBehavior>(
    DEFAULT_USER_SETTINGS.closeBehavior,
  );
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [pendingBehavior, setPendingBehavior] = useState<CloseBehavior | null>(null);

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
          setCurrentBehavior(current.closeBehavior);
        }
      } catch (error) {
        console.error("Failed to load close behavior setting", error);
        toast.error(`Failed to load close behavior setting: ${formatErrorMessage(error)}`);
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

  const handleBehaviorSelect = useCallback(
    async (behavior: CloseBehavior) => {
      if (behavior === currentBehavior) {
        return;
      }

      setPendingBehavior(behavior);
      try {
        const result = await ipcClient.userSettings.update({ closeBehavior: behavior });
        if (!result.success) {
          throw new Error(result.error ?? "Failed to update close behavior");
        }

        setCurrentBehavior(behavior);
        toast.success(`On close: ${CLOSE_BEHAVIOR_LABELS[behavior]}`);
      } catch (error) {
        console.error("Failed to update close behavior", error);
        toast.error(`Failed to update close behavior: ${formatErrorMessage(error)}`);
      } finally {
        setPendingBehavior(null);
      }
    },
    [currentBehavior],
  );

  return (
    <SettingsSection
      title={
        <>
          <X className="h-4 w-4" />
          On Close
        </>
      }
      description="Choose what happens when you close the YakShaver window."
    >
      <div className="grid gap-2 md:grid-cols-2">
        {CLOSE_BEHAVIOR_OPTIONS.map((option) => {
          const isSelected = option.id === currentBehavior;
          const isDisabled = isLoading || (!!pendingBehavior && pendingBehavior !== option.id);

          return (
            <button
              key={option.id}
              type="button"
              onClick={() => void handleBehaviorSelect(option.id)}
              disabled={isDisabled}
              aria-pressed={isSelected}
              className={cn(
                "flex h-full flex-col gap-1.5 rounded-md border px-3 py-2 text-left transition-colors",
                "disabled:cursor-not-allowed disabled:opacity-60",
                isSelected && "border-white/50 bg-white/10",
                !isSelected && "border-white/10 hover:border-white/30 hover:bg-white/5",
              )}
            >
              <span className="text-sm font-medium">{option.title}</span>
              <span className="text-xs leading-relaxed text-muted-foreground">
                {option.description}
              </span>
            </button>
          );
        })}
      </div>
    </SettingsSection>
  );
}
