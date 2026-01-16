import type { WorkflowState, WorkflowStep } from "@shared/types/workflow";
import { CheckCircle2, ChevronDown, ChevronRight, Loader2, XCircle, CircleSlash } from "lucide-react";
import { useEffect, useState } from "react";
import { StageWithContentNeo } from "./StageWithContentNeo";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";

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
      return <Loader2 className="h-5 w-5 animate-spin text-zinc-300" />;
    case "completed":
      return <CheckCircle2 className="h-5 w-5 text-green-400" />;
    case "failed":
      return <XCircle className="h-5 w-5 text-red-400" />;
      case "skipped":
        return <CircleSlash className="h-5 w-5 text-white/20" />;
    case "not_started":
        return <div className="h-5 w-5 rounded-full border-2 border-white/20" />;
    default:
      return <div className="h-5 w-5 rounded-full border-2 border-white/20" />;
  }
};

function WorkflowStepCard ({step,label}: {step: WorkflowStep;label: string;}){
  const [isExpanded, setIsExpanded] = useState(false);
  
  let parsedPayload: any = step.payload;
  let hasPayload = false;

  try {
    if (step.payload) {
      const parsed = JSON.parse(step.payload);
      parsedPayload = parsed;
      hasPayload = parsed !== null && 
                   (typeof parsed === 'object' ? Object.keys(parsed).length > 0 : true);
    }
  } catch (e) {
    hasPayload = !!step.payload;
  }

  const toggleExpand = () => {
    if (hasPayload) setIsExpanded(!isExpanded);
  };

  const getBoxClass = () => {
    switch (step.status) {
      case "in_progress":
        return "border-gray-500/30 bg-gray-500/5";
      case "completed":
        return "border-green-500/30 bg-green-500/5";
      case "failed":
         return "border-red-500/30 bg-red-500/5";
      case "skipped":
        return "border-white/10 bg-black/20";
      case "not_started":
        return "border-white/10 bg-black/20";
      default:
        return "border-white/10 bg-black/20";
    }
  };

  const boxClass = getBoxClass();

  const getTextColor = () => {
    switch (step.status) {
      case "skipped":
        return "text-white/20";
      case "not_started":
        return "text-white/30";
      default:
        return "text-white/90";
    }
  };

  return (
    <div className={`rounded-lg border p-3 transition-all ${boxClass}`}>
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
          <span className={`font-medium ${getTextColor()}`}>{label}</span>
        </div>
        {hasPayload && (
          <button type="button" className="text-white/50 hover:text-white/90">
            {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
        )}
      </div>
      
      {isExpanded && hasPayload && (
        <div className="mt-2 overflow-x-auto rounded bg-black/20 p-2 text-white/80">
          <StageWithContentNeo stage={step.stage} payload={parsedPayload} />
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