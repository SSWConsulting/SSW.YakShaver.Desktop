import { useCallback, useState } from "react";
import { toast } from "sonner";
import { useWorkflowNavigation } from "@/hooks/useWorkflowNavigation";
import { ipcClient } from "@/services/ipc-client";
import { formatErrorMessage } from "@/utils";
import { SHAVES_CHANGED_EVENT } from "../types";

/**
 * #1062: Stop and Retry for a shave in My Shaves. Stop ends a running shave (or records one whose
 * run was lost, e.g. to an app restart, as stopped); Retry re-runs the whole workflow on the same
 * video and opens its progress.
 */
export function useShaveActions() {
  const navigateToWorkflow = useWorkflowNavigation();
  const [isBusy, setIsBusy] = useState(false);

  const runAction = useCallback(
    async (action: () => Promise<{ success: boolean; error?: string }>, failure: string) => {
      setIsBusy(true);
      try {
        const result = await action();
        if (!result.success) {
          throw new Error(result.error ?? failure);
        }
        window.dispatchEvent(new CustomEvent(SHAVES_CHANGED_EVENT));
        return true;
      } catch (error) {
        toast.error(`${failure}: ${formatErrorMessage(error)}`);
        return false;
      } finally {
        setIsBusy(false);
      }
    },
    [],
  );

  const stopShave = useCallback(
    async (shaveId: string) => {
      await runAction(() => ipcClient.workflow.stop(shaveId), "Failed to stop");
    },
    [runAction],
  );

  const retryShave = useCallback(
    async (shaveId: string) => {
      const started = await runAction(() => ipcClient.workflow.restart(shaveId), "Failed to retry");
      if (started) {
        navigateToWorkflow({ shaveId });
      }
    },
    [runAction, navigateToWorkflow],
  );

  return { stopShave, retryShave, isBusy };
}
