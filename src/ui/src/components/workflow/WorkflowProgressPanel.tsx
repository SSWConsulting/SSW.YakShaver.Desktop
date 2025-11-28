import { AlertCircle, CheckCircle2, Loader2, XCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ipcClient } from "../../services/ipc-client";
import {
  ProgressStage,
  type VideoUploadOrigin,
  type WorkflowProgress,
  type WorkflowStage,
} from "../../types";
import { UNDO_EVENT_CHANNEL, type UndoEventDetail } from "../../types/index";
import { Accordion, AccordionItem } from "../ui/accordion";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { type MCPStep, StageWithContent } from "./StageWithContent";
import { StageWithoutContent } from "./StageWithoutContent";
import { UndoStagePanel } from "./UndoStagePanel";

const WORKFLOW_CORE_STAGES: WorkflowStage[] = [
  ProgressStage.CONVERTING_AUDIO,
  ProgressStage.TRANSCRIBING,
  ProgressStage.GENERATING_TASK,
  ProgressStage.EXECUTING_TASK,
];

const EXTERNAL_WORKFLOW_STAGES: WorkflowStage[] = [
  ProgressStage.DOWNLOADING_SOURCE,
  ...WORKFLOW_CORE_STAGES,
];

const RECORDING_WORKFLOW_STAGES: WorkflowStage[] = [
  ProgressStage.UPLOADING_SOURCE,
  ...WORKFLOW_CORE_STAGES,
  ProgressStage.UPDATING_METADATA,
];

const resolveWorkflowOrigin = (progress: WorkflowProgress): VideoUploadOrigin | undefined =>
  progress.sourceOrigin ?? progress.uploadResult?.origin;

const getWorkflowStagesByOrigin = (origin?: VideoUploadOrigin): WorkflowStage[] => {
  if (origin === "external") {
    return EXTERNAL_WORKFLOW_STAGES;
  }
  return RECORDING_WORKFLOW_STAGES;
};

export function WorkflowProgressPanel() {
  const [progress, setProgress] = useState<WorkflowProgress>({ stage: ProgressStage.IDLE });
  const [mcpSteps, setMcpSteps] = useState<MCPStep[]>([]);
  const [undoSteps, setUndoSteps] = useState<MCPStep[]>([]);
  const [undoStatus, setUndoStatus] = useState<"idle" | "in_progress" | "completed" | "error">(
    "idle",
  );
  const [openAccordions, setOpenAccordions] = useState<string[]>([]);
  const stepsRef = useRef<HTMLDivElement | null>(null);
  const undoStatusRef = useRef<"idle" | "in_progress" | "completed" | "error">("idle");
  const sourceOriginRef = useRef<VideoUploadOrigin | undefined>(undefined);

  useEffect(() => {
    undoStatusRef.current = undoStatus;
  }, [undoStatus]);

  useEffect(() => {
    const unsubscribeProgress = ipcClient.workflow.onProgress((data: unknown) => {
      const progressData = data as WorkflowProgress;
      setProgress((prev) => {
        if (
          progressData.stage === ProgressStage.EXECUTING_TASK &&
          prev.stage !== ProgressStage.EXECUTING_TASK
        ) {
          setMcpSteps([]);
        }

        // Reset preserved fields when starting a new workflow
        const isStartingNewWorkflow =
          progressData.stage === ProgressStage.CONVERTING_AUDIO ||
          progressData.stage === ProgressStage.IDLE;

        if (isStartingNewWorkflow) {
          return {
            ...progressData,
            sourceOrigin: progressData.sourceOrigin ?? prev.sourceOrigin,
            metadataPreview: undefined,
            transcript: undefined,
            intermediateOutput: undefined,
            uploadResult: progressData.uploadResult,
          };
        }

        // Merge progress data to preserve fields like metadataPreview and transcript
        return {
          ...prev,
          ...progressData,
          // Preserve these fields if not included in the new update
          metadataPreview: progressData.metadataPreview ?? prev.metadataPreview,
          transcript: progressData.transcript ?? prev.transcript,
          sourceOrigin: progressData.sourceOrigin ?? prev.sourceOrigin,
        };
      });

      const stageIndex = getWorkflowStagesByOrigin(
        progressData.sourceOrigin ?? sourceOriginRef.current,
      ).indexOf(progressData.stage);
      if (stageIndex !== -1) setOpenAccordions([`stage-${stageIndex}`]);

      if (
        progressData.stage === ProgressStage.CONVERTING_AUDIO ||
        progressData.stage === ProgressStage.IDLE
      ) {
        setUndoStatus("idle");
        setUndoSteps([]);
      }
    });
    const undoEventListener = (event: Event) => {
      const detail = (event as CustomEvent<UndoEventDetail>).detail;
      if (!detail) return;
      switch (detail.type) {
        case "start":
          setUndoStatus("in_progress");
          setUndoSteps([]);
          break;
        case "complete":
          setUndoStatus("completed");
          break;
        case "error":
          setUndoStatus("error");
          break;
        case "reset":
          setUndoStatus("idle");
          setUndoSteps([]);
          break;
        default:
          break;
      }
    };

    window.addEventListener(UNDO_EVENT_CHANNEL, undoEventListener as EventListener);

    return () => {
      unsubscribeProgress();
      window.removeEventListener(UNDO_EVENT_CHANNEL, undoEventListener as EventListener);
    };
  }, []);

  useEffect(() => {
    return ipcClient.mcp.onStepUpdate((step) => {
      const targetSetter = undoStatusRef.current === "idle" ? setMcpSteps : setUndoSteps;
      targetSetter((prev) => {
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

  const derivedOrigin = resolveWorkflowOrigin(progress);
  sourceOriginRef.current = derivedOrigin ?? sourceOriginRef.current;
  const workflowStages = getWorkflowStagesByOrigin(sourceOriginRef.current);

  const getStageIcon = (stage: WorkflowStage) => {
    const currentIndex = workflowStages.indexOf(progress.stage);
    const stageIndex = workflowStages.indexOf(stage);
    const isActive = stage === progress.stage;
    const isCompleted = stageIndex < currentIndex || progress.stage === ProgressStage.COMPLETED;
    const isError = progress.stage === ProgressStage.ERROR;

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
    const stageIndex = workflowStages.indexOf(stage);
    const currentIndex = workflowStages.indexOf(progress.stage);

    if (stage === progress.stage) return "border-gray-500/30 bg-gray-500/5";
    if (stageIndex < currentIndex || progress.stage === ProgressStage.COMPLETED) {
      return "border-green-500/30 bg-green-500/5";
    }
    return "border-white/10 bg-black/20";
  };

  if (progress.stage === ProgressStage.IDLE) {
    return (
      <div className="w-[500px] mx-auto my-4">
        <Card className="bg-black/20 backdrop-blur-md border-white/10">
          <CardContent className="py-16 text-center">
            <AlertCircle className="w-16 h-16 text-white/40 mx-auto mb-4" />
            <h3 className="text-xl font-medium mb-2">No Active Workflow</h3>
            <p className="text-white/60">Record a video to start the automated workflow</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const isExternalWorkflow = derivedOrigin === "external";

  return (
    <div className="w-[500px] mx-auto my-4">
      <Card className="bg-black/20 backdrop-blur-md border-white/10">
        <CardHeader>
          <CardTitle className=" text-xl">AI Workflow Progress</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Accordion type="multiple" value={openAccordions} onValueChange={setOpenAccordions}>
            {workflowStages.map((stage, index) => {
              const hideMetadataStage =
                stage === ProgressStage.UPDATING_METADATA && isExternalWorkflow;

              if (hideMetadataStage) {
                return null;
              }

              const hasContent =
                (stage === ProgressStage.TRANSCRIBING && progress.transcript) ||
                (stage === ProgressStage.GENERATING_TASK && progress.intermediateOutput) ||
                (stage === ProgressStage.EXECUTING_TASK && mcpSteps.length > 0) ||
                stage === ProgressStage.UPDATING_METADATA;

              return (
                <AccordionItem
                  key={stage}
                  value={`stage-${index}`}
                  className={`border rounded-lg ${index < workflowStages.length - 1 ? "mb-2" : ""} transition-all ${getStageClassName(stage)}`}
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
                    <StageWithoutContent stage={stage} getStageIcon={getStageIcon} />
                  )}
                </AccordionItem>
              );
            })}
          </Accordion>

          {progress.stage === ProgressStage.ERROR && progress.error && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4">
              <div className="flex items-center gap-2 mb-2">
                <XCircle className="w-5 h-5 text-red-400" />
                <span className="text-red-400 font-medium">Error</span>
              </div>
              <p className="text-white/70 text-sm break-words whitespace-normal max-w-full">
                {progress.error}
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {undoStatus !== "idle" && undoSteps.length > 0 && (
        <div className="mt-3">
          <UndoStagePanel status={undoStatus} steps={undoSteps} stepsRef={stepsRef} />
        </div>
      )}
    </div>
  );
}
