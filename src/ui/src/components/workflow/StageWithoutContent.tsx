import { STAGE_CONFIG, type WorkflowStage } from "../../types";

interface StageWithoutContentProps {
  stage: WorkflowStage;
  getStageIcon: (stage: WorkflowStage) => React.ReactNode;
}

export function StageWithoutContent({ stage, getStageIcon }: StageWithoutContentProps) {
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
