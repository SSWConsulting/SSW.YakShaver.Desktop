import type { WorkflowState } from "@shared/types/workflow";
import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { WorkflowRetryPanel } from "./WorkflowRetryPanel";
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

const STEP_ORDER: (keyof WorkflowState)[] = [
  "uploading_video",
  "downloading_video",
  "converting_audio",
  "transcribing",
  "analyzing_transcript",
  "selecting_prompt",
  "executing_task",
  "updating_metadata",
];

interface FailedStage {
  stage: keyof WorkflowState;
  retryCount: number;
  maxReached: boolean;
  lastError?: string;
}

export function WorkflowProgressPanel() {
  const [state, setState] = useState<WorkflowState | null>(null);
  const [shaveId, setShaveId] = useState<string | undefined>();
  const [failedStages, setFailedStages] = useState<FailedStage[]>([]);

  useEffect(() => {
    const cleanup = window.electronAPI.workflow.onProgressNeo((payload: unknown) => {
      const newState = payload as WorkflowState;
      setState(newState);

      // Extract failed stages with retry info
      const failed: FailedStage[] = [];
      for (const stepKey of STEP_ORDER) {
        const step = newState[stepKey];
        if (step.status === "failed") {
          // Get retry info from payload if available
          const payload = step.payload ? JSON.parse(step.payload) : {};
          failed.push({
            stage: stepKey,
            retryCount: payload.retryCount || 0,
            maxReached: payload.maxReached || false,
            lastError: payload.error,
          });
        }
      }
      setFailedStages(failed);
    });
    return cleanup;
  }, []);

  // Get shaveId from progress events
  useEffect(() => {
    const cleanup = window.electronAPI.workflow.onProgress((payload: unknown) => {
      const data = payload as { shaveId?: string };
      if (data.shaveId) {
        setShaveId(data.shaveId);
      }
    });
    return cleanup;
  }, []);

  if (state) {
    return (
      <div className="w-[500px] mx-auto my-4">
        <Card className="bg-black/20 backdrop-blur-md border-white/10">
          <CardHeader>
            <CardTitle className="text-xl">AI Workflow Progress</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {STEP_ORDER.map((stepKey) => (
              <WorkflowStepCard key={stepKey} step={state[stepKey]} label={STEP_LABELS[stepKey]} />
            ))}
          </CardContent>
        </Card>

        <WorkflowRetryPanel failedStages={failedStages} shaveId={shaveId} />
      </div>
    );
  }

  return null;
}
