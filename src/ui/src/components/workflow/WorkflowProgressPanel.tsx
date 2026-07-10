import { WORKFLOW_STAGE_ORDER, type WorkflowState } from "@shared/types/workflow";
import { AlertTriangle, X } from "lucide-react";
import { useEffect, useState } from "react";
import { isWorkflowFailed, parseWorkflowProgressNeoPayload } from "@/utils";
import { WORKFLOW_CLEAR_EVENT_CHANNEL } from "../../types/index";
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

interface WorkflowProgressPanelProps {
  /**
   * #821: a pre-loaded state to render (when reached by navigation from a past shave) instead
   * of subscribing to live progress events. When omitted, the panel keeps its original live
   * behaviour for an in-flight run.
   */
  hydratedState?: WorkflowState | null;
  /** The shave being viewed (read-only mode); omitted for the live run. */
  hydratedShaveId?: string;
}

export function WorkflowProgressPanel({
  hydratedState,
  hydratedShaveId,
}: WorkflowProgressPanelProps = {}) {
  const [liveState, setLiveState] = useState<WorkflowState | null>(null);
  const [liveShaveId, setLiveShaveId] = useState<string | undefined>();

  const isHydrated = hydratedState != null;

  useEffect(() => {
    // In hydrated (navigated) mode we render a persisted snapshot — don't subscribe to live events.
    if (isHydrated) {
      return;
    }
    const cleanup = window.electronAPI.workflow.onProgressNeo((payload: unknown) => {
      const progress = parseWorkflowProgressNeoPayload(payload);
      if (progress.state) {
        setLiveState(progress.state);
      }
      if (progress.shaveId) {
        setLiveShaveId(progress.shaveId);
      }
    });
    return cleanup;
  }, [isHydrated]);

  const state = hydratedState ?? liveState;
  const shaveId = isHydrated ? hydratedShaveId : liveShaveId;

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

            {hasFailed && (
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
