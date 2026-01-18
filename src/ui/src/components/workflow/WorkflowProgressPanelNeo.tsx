import type { WorkflowState } from "@shared/types/workflow";
import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { WorkflowStepCard } from "./WorkflowStepCard";

const STEP_LABELS: Record<keyof WorkflowState, string> = {
  uploading_video: "Uploading Video",
  downloading_video: "Downloading Video",
  converting_audio: "Converting Audio",
  transcribing: "Transcribing",
  analyzing_transcript: "Analyzing Transcript",
  executing_task: "Executing Task",
  updating_metadata: "Updating Metadata",
};

const STEP_ORDER: (keyof WorkflowState)[] = [
  "uploading_video",
  "downloading_video",
  "converting_audio",
  "transcribing",
  "analyzing_transcript",
  "executing_task",
  "updating_metadata",
];

export function WorkflowProgressPanelNeo() {
  const [state, setState] = useState<WorkflowState | null>(null);

  useEffect(() => {
    const cleanup = window.electronAPI.workflow.onProgressNeo((payload: unknown) => {
      setState(payload as WorkflowState);
    });
    return cleanup;
  }, []);

  if (state) {
    return (
      <div className="w-[500px] mx-auto my-4">
        <Card className="bg-black/20 backdrop-blur-md border-white/10">
          <CardHeader>
            <CardTitle className="text-xl">AI Workflow Progress (Neo)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {STEP_ORDER.map((stepKey) => (
              <WorkflowStepCard
                key={stepKey}
                step={state[stepKey]}
                label={STEP_LABELS[stepKey]}
              />
            ))}
          </CardContent>
        </Card>
      </div>
  );
  }
}