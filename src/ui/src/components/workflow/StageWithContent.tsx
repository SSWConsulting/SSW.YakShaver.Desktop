import { Check, Play, Wrench, X } from "lucide-react";
import type React from "react";
import {
  ProgressStage,
  STAGE_CONFIG,
  type WorkflowProgress,
  type WorkflowStage,
} from "../../types";
import { deepParseJson } from "../../utils";
import { AccordionContent, AccordionTrigger } from "../ui/accordion";
import { ReasoningStep } from "./ReasoningStep";

type StepType = "start" | "reasoning" | "tool_call" | "tool_result" | "final_result";

interface MCPStep {
  type: StepType;
  message?: string;
  reasoning?: string;
  toolName?: string;
  serverName?: string;
  args?: Record<string, unknown>;
  result?: unknown;
  error?: string;
  timestamp?: number;
}

interface StageWithContentProps {
  stage: WorkflowStage;
  progress: WorkflowProgress;
  mcpSteps: MCPStep[];
  stepsRef: React.RefObject<HTMLDivElement | null>;
  getStageIcon: (stage: WorkflowStage) => React.ReactNode;
}

const handleDetailsToggle = (data: unknown) => (e: React.SyntheticEvent<HTMLDetailsElement>) => {
  const details = e.currentTarget;
  if (details.open) {
    const pre = details.querySelector("pre");
    if (pre && !pre.dataset.parsed) {
      pre.textContent = JSON.stringify(deepParseJson(data), null, 2);
      pre.dataset.parsed = "true";
    }
  }
};

function ToolResultError({ error }: { error: string }) {
  return (
    <div className="text-red-400 flex items-center gap-1">
      <X className="w-3 h-3" />
      Error: {error}
    </div>
  );
}

function ToolResultSuccess({ result }: { result: unknown }) {
  return (
    <div className="space-y-1">
      {result !== undefined && result !== null && (
        <details className="text-xs" onToggle={handleDetailsToggle(result)}>
          <summary className="text-zinc-400 cursor-pointer hover:text-zinc-400/80">
            View result
          </summary>
          <pre className="mt-1 p-2 bg-black rounded text-zinc-400 overflow-x-auto max-h-[200px] overflow-y-auto">
            Loading...
          </pre>
        </details>
      )}
    </div>
  );
}

function ToolCallStep({
  toolName,
  serverName,
  args,
}: {
  toolName?: string;
  serverName?: string;
  args?: Record<string, unknown>;
}) {
  const hasArgs = args && Object.keys(args).length > 0;

  return (
    <div className="space-y-1">
      <div className="text-secondary font-medium flex items-center gap-2">
        <Wrench className="w-4 h-4" />
        Calling tool: {toolName}
        <span className="text-zinc-400 text-xs ml-2">(from {serverName})</span>
      </div>
      {hasArgs && (
        <details className="ml-4 text-xs" onToggle={handleDetailsToggle(args)}>
          <summary className="text-zinc-400 cursor-pointer hover:text-zinc-400/80">
            Arguments
          </summary>
          <pre className="mt-1 p-2 bg-black rounded text-zinc-400 overflow-x-auto">Loading...</pre>
        </details>
      )}
    </div>
  );
}

export function StageWithContent({
  stage,
  progress,
  mcpSteps,
  stepsRef,
  getStageIcon,
}: StageWithContentProps) {
  return (
    <>
      <AccordionTrigger className="px-4 hover:no-underline">
        <div className="flex items-center gap-3">
          {getStageIcon(stage)}
          <span className="text-white/90 font-medium">{STAGE_CONFIG[stage]}</span>
        </div>
      </AccordionTrigger>
      <AccordionContent className="px-4 pb-2">
        {stage === ProgressStage.TRANSCRIBING && progress.transcript && (
          <div className="p-3 bg-black/30 border border-white/10 rounded-md text-white/80 text-sm whitespace-pre-wrap">
            {progress.transcript}
          </div>
        )}
        {stage === ProgressStage.GENERATING_TASK &&
          progress.intermediateOutput &&
          progress.stage !== ProgressStage.GENERATING_TASK && (
            <div className="p-3 bg-black/30 border border-white/10 rounded-md text-white/80 text-xs font-mono whitespace-pre-wrap">
              {progress.intermediateOutput}
            </div>
          )}
        {stage === ProgressStage.EXECUTING_TASK && mcpSteps.length > 0 && (
          <div
            ref={stepsRef}
            className="bg-black/30 border border-white/10 rounded-md p-3 max-h-[400px] overflow-y-auto space-y-2"
          >
            {mcpSteps.map((step) => (
              <div key={step.timestamp} className="border-l-2 border-green-400/30 pl-3 py-1">
                {step.type === "start" && (
                  <div className="text-secondary font-medium flex items-center gap-2">
                    <Play className="w-4 h-4" />
                    {step.message || "Start task execution"}
                  </div>
                )}
                {step.type === "reasoning" && step.reasoning && (
                  <ReasoningStep reasoning={step.reasoning} />
                )}
                {step.type === "tool_call" && (
                  <ToolCallStep
                    toolName={step.toolName}
                    serverName={step.serverName}
                    args={step.args}
                  />
                )}
                {step.type === "tool_result" && (
                  <div className="ml-4 space-y-1">
                    {step.error ? (
                      <ToolResultError error={step.error} />
                    ) : (
                      <ToolResultSuccess result={step.result} />
                    )}
                  </div>
                )}
                {step.type === "final_result" && (
                  <div className="text-secondary font-medium flex items-center gap-2">
                    <Check className="w-4 h-4" />
                    {step.message || "Generated final result"}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </AccordionContent>
    </>
  );
}

export type { MCPStep, StageWithContentProps };
