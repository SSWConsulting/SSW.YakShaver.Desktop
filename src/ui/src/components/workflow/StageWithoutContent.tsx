import type { WorkflowStage } from "../../types";

const STAGE_CONFIG: Record<WorkflowStage, string> = {
  idle: "Waiting for recording...",
  converting_audio: "Converting audio",
  transcribing: "Transcribing audio",
  generating_task: "Analyzing transcript",
  executing_task: "Executing task",
  completed: "Completed",
  error: "Error occurred",
};

interface StageWithoutContentProps {
  stage: WorkflowStage;
  getStageIcon: (stage: WorkflowStage) => React.ReactNode;
}

export function StageWithoutContent({
  stage,
  getStageIcon,
}: StageWithoutContentProps) {
  return (
    <div className="px-4 py-3">
      <div className="flex items-center gap-3">
        {getStageIcon(stage)}
        <span className="text-white/90 font-medium">{STAGE_CONFIG[stage]}</span>
      </div>
    </div>
  );
}

export type { StageWithoutContentProps };
