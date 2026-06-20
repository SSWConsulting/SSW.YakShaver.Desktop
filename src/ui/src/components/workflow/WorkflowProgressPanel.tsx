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
  analyzing_transcript: "Analyzing Transcript",
  selecting_prompt: "Selecting Prompt",
  executing_task: "Executing Task",
  updating_metadata: "Updating Metadata",
};

export function WorkflowProgressPanel() {
  const [state, setState] = useState<WorkflowState | null>(null);
  const [shaveId, setShaveId] = useState<string | undefined>();

  useEffect(() => {
    const cleanup = window.electronAPI.workflow.onProgressNeo((payload: unknown) => {
      const progress = parseWorkflowProgressNeoPayload(payload);
      if (progress.state) {
        setState(progress.state);
      }
      if (progress.shaveId) {
        setShaveId(progress.shaveId);
      }
    });
    return cleanup;
  }, []);

  // Dismiss a finished/failed run and return the processing screen to its ready
  // state so the user can start fresh without restarting the app (#733). The
  // sibling FinalResultPanel holds its own state, so broadcast a clear event to
  // reset both panels together rather than orphaning the Final Result card.
  const handleClear = () => {
    setState(null);
    setShaveId(undefined);
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
