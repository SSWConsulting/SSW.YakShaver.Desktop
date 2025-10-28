import { AlertCircle, CheckCircle2, Loader2, XCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ipcClient } from "../../services/ipc-client";
import type { WorkflowProgress, WorkflowStage } from "../../types";
import { Accordion, AccordionItem } from "../ui/accordion";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { type MCPStep, StageWithContent } from "./StageWithContent";
import { StageWithoutContent } from "./StageWithoutContent";

const WORKFLOW_STAGES: WorkflowStage[] = [
  "converting_audio",
  "transcribing",
  "generating_task",
  "executing_task",
];

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
