import { Check, Loader2, Undo2, Wrench, X } from "lucide-react";
import type React from "react";
import { deepParseJson } from "../../utils";
import { ReasoningStep } from "./ReasoningStep";
import type { MCPStep } from "./StageWithContent";

const handleDetailsToggle =
  (data: unknown) => (e: React.SyntheticEvent<HTMLDetailsElement>) => {
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
          <summary className="text-zinc-300 cursor-pointer hover:text-zinc-200 transition-colors">
            View result
          </summary>
          <pre className="mt-1 p-2 bg-black rounded text-zinc-200 overflow-x-auto max-h-[200px] overflow-y-auto">
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
      <div className="text-purple-200 font-medium flex items-center gap-2">
        <Wrench className="w-4 h-4" />
        Calling tool: {toolName}
        <span className="text-zinc-400 text-xs ml-2">(from {serverName})</span>
      </div>
      {hasArgs && (
        <details className="ml-4 text-xs" onToggle={handleDetailsToggle(args)}>
          <summary className="text-zinc-300 cursor-pointer hover:text-zinc-100 transition-colors">
            Arguments
          </summary>
          <pre className="mt-1 p-2 bg-black rounded text-zinc-200 overflow-x-auto">Loading...</pre>
        </details>
      )}
    </div>
  );
}

interface UndoStagePanelProps {
  steps: MCPStep[];
  status: "idle" | "in_progress" | "completed" | "error";
  stepsRef: React.RefObject<HTMLDivElement | null>;
}

const StatusBadge = ({ status }: { status: UndoStagePanelProps["status"] }) => {
  if (status === "in_progress") {
    return <Loader2 className="w-4 h-4 text-purple-200 animate-spin" />;
  }
  if (status === "completed") {
    return <Check className="w-4 h-4 text-green-300" />;
  }
  if (status === "error") {
    return <X className="w-4 h-4 text-red-400" />;
  }
  return null;
};

export function UndoStagePanel({ steps, status, stepsRef }: UndoStagePanelProps) {

  return (
    <div className="border border-purple-500/40 rounded-xl bg-purple-500/10 backdrop-blur px-4 py-3 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-purple-100 font-semibold">
          <Undo2 className="w-4 h-4" />
          Undo Workflow
        </div>
        <StatusBadge status={status} />
      </div>

      <div
        ref={stepsRef}
        className="bg-black/40 border border-purple-500/30 rounded-md p-3 max-h-[400px] overflow-y-auto space-y-2"
      >
        {steps.length === 0 ? (
          <p className="text-sm text-purple-100/70">Undo is starting up...</p>
        ) : (
          steps.map((step) => (
            <div
              key={step.timestamp}
              className="border-l-2 border-purple-400/50 pl-3 py-1 space-y-1 text-white/90"
            >
              {step.type === "start" && (
                <div className="text-purple-200 font-medium flex items-center gap-2">
                  <Undo2 className="w-4 h-4" />
                  {step.message || "Undo workflow started"}
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
                <div className="text-purple-100 font-medium flex items-center gap-2">
                  <Check className="w-4 h-4" />
                  {step.message || "Undo completed"}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

