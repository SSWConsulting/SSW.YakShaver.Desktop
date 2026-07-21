import {
  DEFAULT_USER_SETTINGS,
  MAX_EXECUTING_TASK_TIMEOUT_MS,
  MIN_EXECUTING_TASK_TIMEOUT_MS,
} from "@shared/types/user-settings";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ipcClient } from "@/services/ipc-client";
import { formatErrorMessage } from "@/utils";
import { SettingsSection } from "../SettingsSection";

interface ExecutingTaskTimeoutSettingProps {
  isActive: boolean;
}

const MIN_MINUTES = Math.ceil(MIN_EXECUTING_TASK_TIMEOUT_MS / 60_000) || 1;
const MAX_MINUTES = Math.floor(MAX_EXECUTING_TASK_TIMEOUT_MS / 60_000);

/**
 * Lets the user tune how long the Executing Task stage (the MCP/AI agent loop) can run before
 * it's treated as stuck and failed with a timeout — the fix for #698, where a hung loop (e.g.
 * repeatedly retrying a tool/resource that doesn't exist) could previously run for 30+ minutes
 * with no error and no way to retry.
 */
export function ExecutingTaskTimeoutSetting({ isActive }: ExecutingTaskTimeoutSettingProps) {
  const [minutes, setMinutes] = useState<number>(
    Math.round(DEFAULT_USER_SETTINGS.executingTaskTimeoutMs / 60_000),
  );
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!isActive) return;

    let cancelled = false;
    (async () => {
      setIsLoading(true);
      try {
        const current = await ipcClient.userSettings.get();
        if (!cancelled) {
          setMinutes(Math.round(current.executingTaskTimeoutMs / 60_000));
        }
      } catch (error) {
        console.error("Failed to load Executing Task timeout setting", error);
        toast.error(`Failed to load timeout setting: ${formatErrorMessage(error)}`);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isActive]);

  const commitMinutes = async (rawMinutes: number) => {
    const clampedMinutes = Math.min(MAX_MINUTES, Math.max(MIN_MINUTES, Math.round(rawMinutes)));
    setMinutes(clampedMinutes);

    setIsSaving(true);
    try {
      const result = await ipcClient.userSettings.update({
        executingTaskTimeoutMs: clampedMinutes * 60_000,
      });
      if (!result.success) {
        throw new Error(result.error ?? "Failed to update timeout setting");
      }
    } catch (error) {
      console.error("Failed to update Executing Task timeout setting", error);
      toast.error(`Failed to update timeout setting: ${formatErrorMessage(error)}`);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <SettingsSection
      title="Executing Task Timeout"
      description="How long the AI agent can run on a single task before it's treated as stuck, fails with a timeout error, and offers a Retry."
      contentClassName="flex items-center gap-3"
    >
      <input
        type="number"
        min={MIN_MINUTES}
        max={MAX_MINUTES}
        step={1}
        value={minutes}
        disabled={isLoading || isSaving}
        onChange={(e) => setMinutes(Number(e.target.value))}
        onBlur={(e) => void commitMinutes(Number(e.target.value))}
        className="h-9 w-20 rounded-md border border-white/15 bg-black/20 px-2 text-sm text-white/90 disabled:opacity-60"
        aria-label="Executing Task timeout in minutes"
      />
      <span className="text-sm text-muted-foreground">minutes</span>
    </SettingsSection>
  );
}
