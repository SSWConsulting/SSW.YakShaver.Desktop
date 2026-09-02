import { WORKFLOW_STAGE_ORDER, type WorkflowState } from "@shared/types/workflow";
import { AlertTriangle, CircleStop, RefreshCw, X } from "lucide-react";
import { useEffect, useEffectEvent, useState } from "react";
import { toast } from "sonner";
import { ipcClient } from "@/services/ipc-client";
import {
  findStoppedStage,
  formatErrorMessage,
  isWorkflowFailed,
  parseWorkflowProgressNeoPayload,
} from "@/utils";
import { WORKFLOW_CLEAR_EVENT_CHANNEL } from "../../types/index";
import { LoadingState } from "../common/LoadingState";
import { Button } from "../ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { WorkflowStepCard } from "./WorkflowStepCard";

const STEP_LABELS: Record<keyof WorkflowState, string> = {
  uploading_video: "Uploading Video",
  downloading_video: "Downloading Video",
  converting_audio: "Converting Audio",
  transcribing: "Transcribing",
  optimizing_transcript: "Optimizing Transcript",
  analyzing_transcript: "Analyzing Transcript",
  selecting_prompt: "Selecting Prompt",
  executing_task: "Executing Task",
  updating_metadata: "Updating Metadata",
};

type WorkflowProgressPanelProps =
  | { mode?: "live"; shaveId?: never; hydratedState?: never }
  | {
      mode: "selected";
      shaveId: string;
      hydratedState?: never;
      onAvailabilityChange: (available: boolean) => void;
    }
  | { mode: "hydrated"; shaveId?: string; hydratedState: WorkflowState };

export function WorkflowProgressPanel(props: WorkflowProgressPanelProps = { mode: "live" }) {
  const [liveState, setLiveState] = useState<WorkflowState | null>(null);
  const [liveShaveId, setLiveShaveId] = useState<string | undefined>();
  const [isRetrying, setIsRetrying] = useState(false);

  const isHydrated = props.mode === "hydrated";
  const selectedShaveId = props.mode === "selected" ? props.shaveId : undefined;
  const onAvailabilityChange = props.mode === "selected" ? props.onAvailabilityChange : undefined;
  const hydratedState = props.mode === "hydrated" ? props.hydratedState : null;
  const hydratedShaveId = props.mode === "hydrated" ? props.shaveId : undefined;
  const notifyAvailability = useEffectEvent((available: boolean) => {
    onAvailabilityChange?.(available);
  });

  useEffect(() => {
    // In hydrated (navigated) mode we render a persisted snapshot — don't subscribe to live events.
    if (isHydrated) {
      return;
    }

    let cancelled = false;
    let receivedLiveUpdate = false;
    setLiveState(null);
    setLiveShaveId(selectedShaveId);

    const cleanup = ipcClient.workflow.onProgressNeo((payload: unknown) => {
      const progress = parseWorkflowProgressNeoPayload(payload);
      if (selectedShaveId && progress.shaveId !== selectedShaveId) {
        return;
      }
      if (progress.state) {
        receivedLiveUpdate = true;
        notifyAvailability(true);
        setLiveState(progress.state);
      }
      if (progress.shaveId) {
        setLiveShaveId(progress.shaveId);
      }
    });

    if (selectedShaveId) {
      void ipcClient.workflow
        .getState(selectedShaveId)
        .then((result) => {
          if (cancelled || receivedLiveUpdate) {
            return;
          }
          if (result.success && result.state) {
            setLiveState(result.state);
          }
          if (!result.success && result.reason === "not_found") {
            notifyAvailability(false);
          } else if (!result.success) {
            toast.error("Failed to load workflow progress", { description: result.error });
          }
        })
        .catch((error) => {
          if (!cancelled && !receivedLiveUpdate) {
            toast.error("Failed to load workflow progress", {
              description: formatErrorMessage(error),
            });
          }
        });
    }

    return () => {
      cancelled = true;
      cleanup();
    };
  }, [isHydrated, selectedShaveId]);

  const state = hydratedState ?? liveState;
  const shaveId = isHydrated ? hydratedShaveId : (liveShaveId ?? selectedShaveId);

  // Dismiss a finished/failed run and return the processing screen to its ready
  // state so the user can start fresh without restarting the app (#733). The
  // sibling FinalResultPanel holds its own state, so broadcast a clear event to
  // reset both panels together rather than orphaning the Final Result card.
  const handleClear = () => {
    setLiveState(null);
    setLiveShaveId(undefined);
    window.dispatchEvent(new CustomEvent(WORKFLOW_CLEAR_EVENT_CHANNEL));
  };

  if (state) {
    const hasFailed = isWorkflowFailed(state);
    // A run the user stopped themselves is not a failure — it just ended early, and picking it
    // back up is the likely next move, so it gets its own message and a retry alongside Clear.
    const stoppedStage = findStoppedStage(state);

    const handleRetryStoppedStage = async () => {
      if (!stoppedStage || !shaveId) return;

      setIsRetrying(true);
      try {
        const result = await ipcClient.workflow.retryFromStage(stoppedStage, shaveId);
        if (!result?.success) {
          throw new Error(result?.error || "Retry failed");
        }
      } catch (error) {
        toast.error("Retry failed", { description: formatErrorMessage(error) });
      } finally {
        setIsRetrying(false);
      }
    };

    return (
      <div className="w-[500px] mx-auto my-4">
        <Card className="bg-black/20 backdrop-blur-md border-white/10">
          <CardHeader>
            <CardTitle className="text-xl">AI Workflow Progress</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {WORKFLOW_STAGE_ORDER.map((stepKey) => (
              <WorkflowStepCard
                key={stepKey}
                step={state[stepKey]}
                label={STEP_LABELS[stepKey]}
                shaveId={shaveId}
              />
            ))}

            {hasFailed && stoppedStage && (
              <div className="mt-4 flex flex-col gap-3 rounded-lg border border-white/15 bg-white/5 p-3">
                <div className="flex items-start gap-2 text-sm text-white/80">
                  <CircleStop className="size-4 mt-0.5 shrink-0 text-danger" />
                  <span>
                    You stopped this run at &ldquo;{STEP_LABELS[stoppedStage]}&rdquo;. Retry that
                    step to pick up from there, or clear this run to start fresh.
                  </span>
                </div>
                <div className="flex gap-2">
                  {shaveId && (
                    <Button
                      size="sm"
                      disabled={isRetrying}
                      onClick={handleRetryStoppedStage}
                      aria-label={`Retry ${STEP_LABELS[stoppedStage]}`}
                    >
                      {isRetrying ? (
                        <LoadingState inline className="size-3.5" />
                      ) : (
                        <RefreshCw className="size-4" />
                      )}
                      Retry {STEP_LABELS[stoppedStage]}
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleClear}
                    aria-label="Clear stopped workflow"
                  >
                    <X className="size-4" />
                    Clear
                  </Button>
                </div>
              </div>
            )}

            {hasFailed && !stoppedStage && (
              <div className="mt-4 flex flex-col gap-3 rounded-lg border border-red-500/30 bg-red-500/5 p-3">
                <div className="flex items-start gap-2 text-sm text-red-400/90">
                  <AlertTriangle className="size-4 mt-0.5 shrink-0" />
                  <span>
                    Processing failed. Retry a step above, or clear this run to start fresh.
                  </span>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleClear}
                  className="self-start"
                  aria-label="Clear failed workflow"
                >
                  <X className="size-4" />
                  Clear
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  return null;
}
