import { AlertCircle, CheckCircle2, Loader2, XCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ipcClient } from "../../services/ipc-client";
import type { WorkflowProgress, WorkflowStage } from "../../types";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "../ui/accordion";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";

interface MCPStep {
  type: "start" | "tool_call" | "final_result";
  message?: string;
  toolName?: string;
  serverName?: string;
  timestamp: number;
}

const STAGE_CONFIG: Record<WorkflowStage, string> = {
  idle: "Waiting for recording...",
  converting_audio: "Converting audio",
  transcribing: "Transcribing audio",
  generating_task: "Analyzing transcript",
  executing_task: "Executing task",
  completed: "Completed",
  error: "Error occurred",
};

const WORKFLOW_STAGES: WorkflowStage[] = [
  "converting_audio",
  "transcribing",
  "generating_task",
  "executing_task",
];

interface StageWithContentProps {
  stage: WorkflowStage;
  progress: WorkflowProgress;
  mcpSteps: MCPStep[];
  stepsRef: React.RefObject<HTMLDivElement | null>;
  getStageIcon: (stage: WorkflowStage) => React.ReactNode;
  formatStep: (step: MCPStep, index: number) => string;
}

function StageWithContent({
  stage,
  progress,
  mcpSteps,
  stepsRef,
  getStageIcon,
  formatStep,
}: StageWithContentProps) {
  return (
    <>
      <AccordionTrigger className="px-4 hover:no-underline">
        <div className="flex items-center gap-3">
          {getStageIcon(stage)}
          <span className="text-white/90 font-medium">
            {STAGE_CONFIG[stage]}
          </span>
        </div>
      </AccordionTrigger>
      <AccordionContent className="px-4 pb-2">
        {stage === "transcribing" && progress.transcript && (
          <div className="p-3 bg-black/30 border border-white/10 rounded-md text-white/80 text-sm whitespace-pre-wrap">
            {progress.transcript}
          </div>
        )}
        {stage === "generating_task" &&
          progress.intermediateOutput &&
          progress.stage !== "generating_task" && (
            <div className="p-3 bg-black/30 border border-white/10 rounded-md text-white/80 text-xs font-mono whitespace-pre-wrap">
              {progress.intermediateOutput}
            </div>
          )}
        {stage === "executing_task" && mcpSteps.length > 0 && (
          <div
            ref={stepsRef}
            className="bg-black/30 border border-white/10 rounded-md p-3 max-h-[200px] overflow-y-auto font-mono text-xs text-green-400"
          >
            {mcpSteps.map((step) => (
              <div key={step.timestamp} className="mb-1 last:mb-0">
                {formatStep(
                  step,
                  mcpSteps.findIndex((s) => s.timestamp === step.timestamp),
                )}
              </div>
            ))}
          </div>
        )}
      </AccordionContent>
    </>
  );
}

interface StageWithoutContentProps {
  stage: WorkflowStage;
  getStageIcon: (stage: WorkflowStage) => React.ReactNode;
}

function StageWithoutContent({
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

export function WorkflowProgressPanel() {
  const [progress, setProgress] = useState<WorkflowProgress>({ stage: "idle" });
  const [mcpSteps, setMcpSteps] = useState<MCPStep[]>([]);
  const [openAccordions, setOpenAccordions] = useState<string[]>([]);
  const stepsRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    return ipcClient.workflow.onProgress((data: unknown) => {
      const progressData = data as WorkflowProgress;
      setProgress((prev) => {
        if (
          progressData.stage === "executing_task" &&
          prev.stage !== "executing_task"
        ) {
          setMcpSteps([]);
        }
        return progressData;
      });

      const stageIndex = WORKFLOW_STAGES.indexOf(progressData.stage);
      if (stageIndex !== -1) setOpenAccordions([`stage-${stageIndex}`]);
    });
  }, []);

  useEffect(() => {
    return ipcClient.mcp.onStepUpdate((step) => {
      setMcpSteps((prev) => {
        const updated = [...prev, { ...step, timestamp: Date.now() }];
        requestAnimationFrame(() => {
          if (stepsRef.current) {
            stepsRef.current.scrollTop = stepsRef.current.scrollHeight;
          }
        });
        return updated;
      });
    });
  }, []);

  const getStageIcon = (stage: WorkflowStage) => {
    const currentIndex = WORKFLOW_STAGES.indexOf(progress.stage);
    const stageIndex = WORKFLOW_STAGES.indexOf(stage);
    const isActive = stage === progress.stage;
    const isCompleted =
      stageIndex < currentIndex || progress.stage === "completed";
    const isError = progress.stage === "error";

    if (isError && stage === progress.stage) {
      return <XCircle className="w-4 h-4 text-red-400" />;
    }
    if (isCompleted) {
      return <CheckCircle2 className="w-4 h-4 text-green-400" />;
    }
    if (isActive) {
      return <Loader2 className="w-4 h-4 animate-spin text-zinc-300" />;
    }
    return <div className="w-4 h-4 rounded-full border-2 border-white/20" />;
  };

  const formatStep = (step: MCPStep, index: number): string => {
    const num = index + 1;
    if (step.type === "start")
      return `${num}. ${step.message || "Start task execution"}`;
    if (step.type === "tool_call")
      return `${num}. Call tool "${step.toolName}" from server "${step.serverName}"`;
    if (step.type === "final_result")
      return `${num}. ${step.message || "Generate final result"}`;
    return `${num}. Unknown step`;
  };

  const getStageClassName = (stage: WorkflowStage) => {
    const stageIndex = WORKFLOW_STAGES.indexOf(stage);
    const currentIndex = WORKFLOW_STAGES.indexOf(progress.stage);

    if (stage === progress.stage) return "border-gray-500/30 bg-gray-500/5";
    if (stageIndex < currentIndex || progress.stage === "completed") {
      return "border-green-500/30 bg-green-500/5";
    }
    return "border-white/10 bg-black/20";
  };

  if (progress.stage === "idle") {
    return (
      <div className="w-[500px] mx-auto my-4">
        <Card className="bg-black/20 backdrop-blur-md border-white/10">
          <CardContent className="py-16 text-center">
            <AlertCircle className="w-16 h-16 text-white/40 mx-auto mb-4" />
            <h3 className="text-white text-xl font-medium mb-2">
              No Active Workflow
            </h3>
            <p className="text-white/60">
              Record a video to start the automated workflow
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="w-[500px] mx-auto my-4">
      <Card className="bg-black/20 backdrop-blur-md border-white/10">
        <CardHeader>
          <CardTitle className="text-white text-xl">
            AI Workflow Progress
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Accordion
            type="multiple"
            value={openAccordions}
            onValueChange={setOpenAccordions}
          >
            {WORKFLOW_STAGES.map((stage, index) => {
              const hasContent =
                (stage === "transcribing" && progress.transcript) ||
                (stage === "generating_task" && progress.intermediateOutput) ||
                (stage === "executing_task" && mcpSteps.length > 0);

              return (
                <AccordionItem
                  key={stage}
                  value={`stage-${index}`}
                  className={`border rounded-lg ${index < WORKFLOW_STAGES.length - 1 ? "mb-2" : ""} transition-all ${getStageClassName(stage)}`}
                >
                  {hasContent ? (
                    <StageWithContent
                      stage={stage}
                      progress={progress}
                      mcpSteps={mcpSteps}
                      stepsRef={stepsRef}
                      getStageIcon={getStageIcon}
                      formatStep={formatStep}
                    />
                  ) : (
                    <StageWithoutContent
                      stage={stage}
                      getStageIcon={getStageIcon}
                    />
                  )}
                </AccordionItem>
              );
            })}
          </Accordion>

          {progress.stage === "error" && progress.error && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4">
              <div className="flex items-center gap-2 mb-2">
                <XCircle className="w-5 h-5 text-red-400" />
                <span className="text-red-400 font-medium">Error</span>
              </div>
              <p className="text-white/70 text-sm">{progress.error}</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
