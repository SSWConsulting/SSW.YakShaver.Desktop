import type { WorkflowState, WorkflowStep } from "@shared/types/workflow";
import { CheckCircle2, ChevronDown, ChevronRight, Loader2, XCircle } from "lucide-react";
import { useEffect, useState } from "react";

const STEP_LABELS: Record<keyof WorkflowState, string> = {
  uploading_video: "Uploading Video",
  downloading_video: "Downloading Video",
  converting_audio: "Converting Audio",
  transcribing: "Transcribing",
  analyzing_transcript: "Analyzing Transcript",
  executing_task: "Executing Task",
  updating_metadata: "Updating Metadata",
  final_step: "Final Step",
};

const STEP_ORDER: (keyof WorkflowState)[] = [
  "uploading_video",
  "downloading_video",
  "converting_audio",
  "transcribing",
  "analyzing_transcript",
  "executing_task",
  "updating_metadata",
  "final_step",
];

const StatusIcon = ({ status }: { status: WorkflowStep["status"] }) => {
  switch (status) {
    case "in_progress":
      return <Loader2 className="h-5 w-5 animate-spin text-blue-500" />;
    case "completed":
      return <CheckCircle2 className="h-5 w-5 text-green-500" />;
    case "failed":
      return <XCircle className="h-5 w-5 text-red-500" />;
    case "not_started":
    default:
      return <div className="h-5 w-5 rounded-full border-2 border-gray-300" />;
  }
};

function WorkflowStepCard ({step,label}: {step: WorkflowStep;label: string;}){
  const [isExpanded, setIsExpanded] = useState(false);
  const hasPayload = step.payload && step.payload !== "{}";

  // Parse payload for display if it's JSON
  let displayPayload = step.payload;
  try {
    if (step.payload) {
      const parsed = JSON.parse(step.payload);
      displayPayload = JSON.stringify(parsed, null, 2);
    }
  } catch (e) {
    // ignore, keep as string
  }

  const toggleExpand = () => {
    if (hasPayload) setIsExpanded(!isExpanded);
  };

  const boxClass = step.status === "not_started" ? "bg-gray-50 border-gray-200" : "bg-white border-gray-200 shadow-sm";

  return (
    <div className={`rounded-lg border p-3 ${boxClass}`}>
      {/** biome-ignore lint/a11y/noStaticElementInteractions: <explanation> */}
      <div 
        className={`flex items-center justify-between ${hasPayload ? "cursor-pointer" : ""}`}
        onClick={toggleExpand}
        onKeyDown={(e) => {
          if (hasPayload && (e.key === "Enter" || e.key === " ")) {
            e.preventDefault();
            toggleExpand();
          }
        }}
        role={hasPayload ? "button" : undefined}
        tabIndex={hasPayload ? 0 : undefined}
      >
        <div className="flex items-center gap-3">
          <StatusIcon status={step.status} />
          <span className={`font-medium ${step.status === "not_started" ? "text-gray-400" : "text-gray-700"}`}>{label}</span>
        </div>
        {hasPayload && (
          <button type="button" className="text-gray-500 hover:text-gray-700">
            {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
        )}
      </div>
      
      {isExpanded && hasPayload && (
        <div className="mt-2 overflow-x-auto rounded bg-gray-50 p-2 text-xs text-gray-600">
          <pre>{displayPayload}</pre>
        </div>
      )}
    </div>
  );
}

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
    <div className="flex flex-col gap-2 p-4 max-w-2xl mx-auto">
      {STEP_ORDER.map((stepKey) => (
        <WorkflowStepCard
          key={stepKey}
          step={state[stepKey]}
          label={STEP_LABELS[stepKey]}
        />
      ))}
    </div>
  );
  }
}