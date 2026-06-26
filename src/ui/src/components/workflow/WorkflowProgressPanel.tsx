import { WORKFLOW_STAGE_ORDER, type WorkflowState } from "@shared/types/workflow";
import { useEffect, useState } from "react";
import { parseWorkflowProgressNeoPayload } from "@/utils";
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

  if (state) {
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
          </CardContent>
        </Card>
      </div>
    );
  }

  return null;
}
