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

  // TODO: Deprecated WORKFLOW_PROGRESS listener kept here temporarily for review.
  // useEffect(() => {
  //   const cleanup = window.electronAPI.workflow.onProgress((payload: unknown) => {
  //     const data = payload as { shaveId?: string };
  //     if (data.shaveId) {
  //       setShaveId(data.shaveId);
  //     }
  //   });
  //   return cleanup;
  // }, []);

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
