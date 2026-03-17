import type { WorkflowState } from "@shared/types/workflow";
import { AlertTriangle, RefreshCw, XCircle } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { formatErrorMessage } from "@/utils";
import { ipcClient } from "../../services/ipc-client";
import { Button } from "../ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "../ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";

interface RetryableStage {
  stage: keyof WorkflowState;
  retryCount: number;
  maxReached: boolean;
  lastError?: string;
}

const STAGE_DISPLAY_NAMES: Record<string, string> = {
  uploading_video: "Upload Video",
  downloading_video: "Download Video",
  converting_audio: "Convert Audio",
  transcribing: "Transcribe",
  analyzing_transcript: "Analyze Transcript",
  selecting_prompt: "Select Project",
  executing_task: "Execute Task",
  updating_metadata: "Update YouTube Metadata",
};

interface WorkflowRetryPanelProps {
  failedStages: RetryableStage[];
  shaveId?: string;
  onRetryStarted?: () => void;
}

export function WorkflowRetryPanel({
  failedStages,
  shaveId,
  onRetryStarted,
}: WorkflowRetryPanelProps) {
  const [isRetrying, setIsRetrying] = useState(false);
  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false);
  const [selectedStage, setSelectedStage] = useState<keyof WorkflowState | null>(null);

  // Only show if there are failed stages that haven't reached max retries
  const availableRetries = failedStages.filter((s) => !s.maxReached);

  if (availableRetries.length === 0 && failedStages.length === 0) {
    return null;
  }

  const handleRetryClick = (stage: keyof WorkflowState) => {
    setSelectedStage(stage);
    setConfirmDialogOpen(true);
  };

  const handleConfirmRetry = async () => {
    if (!selectedStage || !shaveId) return;

    setIsRetrying(true);
    setConfirmDialogOpen(false);

    try {
      onRetryStarted?.();

      const result = await ipcClient.workflow.retryFromStage(selectedStage, shaveId);

      if (result?.success) {
        toast.success(`Retry from ${STAGE_DISPLAY_NAMES[selectedStage] || selectedStage} started`, {
          description: "The workflow will continue from this stage.",
        });
      } else {
        throw new Error(result?.error || "Retry failed");
      }
    } catch (error) {
      toast.error(`Failed to retry stage`, {
        description: formatErrorMessage(error),
      });
    } finally {
      setIsRetrying(false);
      setSelectedStage(null);
    }
  };

  const handleCancelAll = async () => {
    if (!shaveId) return;

    try {
      await ipcClient.workflow.cancelRetry(shaveId);
      toast.success("Retry state cleared", {
        description: "All retry data has been cleared.",
      });
    } catch (error) {
      console.error("Failed to cancel retry:", error);
    }
  };

  return (
    <>
      <Card className="mt-4 bg-red-500/10 border-red-500/30">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-red-400" />
            <CardTitle className="text-base text-red-400">Workflow Failed</CardTitle>
          </div>
          <CardDescription className="text-white/70">
            Some stages failed. You can retry up to 3 times for each failed stage.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {failedStages.map((failedStage) => (
            <div
              key={failedStage.stage}
              className="flex items-center justify-between p-3 bg-black/30 rounded-lg border border-white/10"
            >
              <div className="flex items-center gap-3">
                {failedStage.maxReached ? (
                  <XCircle className="w-4 h-4 text-red-500" />
                ) : (
                  <RefreshCw className="w-4 h-4 text-yellow-400" />
                )}
                <div>
                  <p className="text-sm font-medium text-white">
                    {STAGE_DISPLAY_NAMES[failedStage.stage] || failedStage.stage}
                  </p>
                  <p className="text-xs text-white/50">
                    {failedStage.maxReached
                      ? "Max retries reached (3/3)"
                      : `Retry ${failedStage.retryCount + 1} of 3`}
                  </p>
                </div>
              </div>
              <Button
                variant={failedStage.maxReached ? "ghost" : "secondary"}
                size="sm"
                disabled={failedStage.maxReached || isRetrying}
                onClick={() => handleRetryClick(failedStage.stage)}
              >
                {failedStage.maxReached ? "Max Retries" : "Retry"}
              </Button>
            </div>
          ))}
        </CardContent>
        {availableRetries.length > 0 && (
          <CardFooter className="pt-0">
            <Button
              variant="ghost"
              size="sm"
              className="text-white/50 hover:text-white"
              onClick={handleCancelAll}
            >
              Cancel and Clear All
            </Button>
          </CardFooter>
        )}
      </Card>

      <Dialog open={confirmDialogOpen} onOpenChange={setConfirmDialogOpen}>
        <DialogContent className="bg-black/95 border-white/20 text-white">
          <DialogHeader>
            <DialogTitle className="text-white">Confirm Retry</DialogTitle>
            <DialogDescription className="text-white/70">
              Are you sure you want to retry the &quot;
              {selectedStage && STAGE_DISPLAY_NAMES[selectedStage]}&quot; stage?
            </DialogDescription>
          </DialogHeader>
          <div className="text-sm text-white/50">
            <p>
              This will attempt to restart the workflow from this stage. Previous successful stages
              will be preserved.
            </p>
            {selectedStage && (
              <p className="mt-2">
                Attempt {failedStages.find((s) => s.stage === selectedStage)?.retryCount || 0 + 1}{" "}
                of 3.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setConfirmDialogOpen(false)}
              className="text-white hover:text-white hover:bg-white/10"
            >
              Cancel
            </Button>
            <Button type="button" onClick={handleConfirmRetry} disabled={isRetrying}>
              {isRetrying ? (
                <>
                  <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                  Starting...
                </>
              ) : (
                "Confirm Retry"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
