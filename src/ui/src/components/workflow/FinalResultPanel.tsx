import { Copy, ExternalLink, Loader2, RotateCcw, Undo2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useClipboard } from "../../hooks/useClipboard";
import { ipcClient } from "../../services/ipc-client";
import { ProgressStage, type WorkflowProgress, type WorkflowStage } from "../../types";
import type { MCPStep } from "./StageWithContent";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "../ui/dialog";
import { Label } from "../ui/label";
import { Textarea } from "../ui/textarea";

const URL_REGEX = /(https?:\/\/[^\s]+)/g;

interface ParsedResult {
  Status?: "success" | "fail";
  [key: string]: unknown;
}

interface RawTextDisplayProps {
  content: string;
}

const isValidUrl = (str: string): boolean => {
  try {
    new URL(str);
    return true;
  } catch {
    return false;
  }
};

const containsUrl = (text: string): boolean => {
  const regex = new RegExp(URL_REGEX.source, URL_REGEX.flags);
  return regex.test(text);
};

function RawTextDisplay({ content }: RawTextDisplayProps) {
  return (
    <div className="text-white/80 text-sm font-mono whitespace-pre-wrap bg-white/5 p-4 rounded-md border border-white/10">
      {content}
    </div>
  );
}

function JsonResultDisplay({ data }: { data: ParsedResult }) {
  const { copyToClipboard } = useClipboard();
  const entries = Object.entries(data).filter(([key]) => key !== "Status" && key !== "IssueNumber");

  return (
    <div className="space-y-4">
      {entries.map(([key, value]) => (
        <div key={key}>
          <SectionHeader title={key} />
          <ValueRenderer value={value} onCopy={copyToClipboard} />
        </div>
      ))}
    </div>
  );
}

interface LinkActionButtonsProps {
  url: string;
  onCopy: (text: string) => void;
}

function LinkActionButtons({ url, onCopy }: LinkActionButtonsProps) {
  return (
    <div className="flex items-center gap-1 shrink-0">
      <button
        type="button"
        onClick={() => onCopy(url)}
        className="p-1.5 rounded-md text-white/40 hover:text-white/80 hover:bg-white/10 transition-colors"
        title="Copy to clipboard"
      >
        <Copy className="w-3.5 h-3.5" />
      </button>
      <button
        type="button"
        onClick={() => window.open(url, "_blank")}
        className="p-1.5 rounded-md text-white/40 hover:text-white/80 hover:bg-white/10 transition-colors"
        title="Open in browser"
      >
        <ExternalLink className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

interface LinkifiedTextProps {
  text: string;
}

function LinkifiedText({ text }: LinkifiedTextProps) {
  const regex = new RegExp(URL_REGEX.source, URL_REGEX.flags);
  const parts = text.split(regex);

  return (
    <>
      {parts.map((part, index) => {
        const isUrl = regex.test(part);
        // Reset regex after test
        regex.lastIndex = 0;

        if (isUrl || part.match(/^https?:\/\//)) {
          return (
            <a
              key={`link-${part.slice(0, 50)}-${index}`}
              href={part}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-400 hover:text-blue-300 underline"
              onClick={(e) => {
                e.preventDefault();
                window.open(part, "_blank");
              }}
            >
              {part}
            </a>
          );
        }
        return part ? <span key={`text-${part.slice(0, 50)}-${index}`}>{part}</span> : null;
      })}
    </>
  );
}

interface UrlDisplayProps {
  url: string;
  onCopy: (text: string) => void;
}

function UrlDisplay({ url, onCopy }: UrlDisplayProps) {
  return (
    <div className="group flex items-center gap-2 p-2 bg-white/5 rounded-md border border-white/10 hover:border-white/20 transition-colors">
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="flex-1 text-sm text-blue-400 hover:text-blue-300 transition-colors break-all font-mono"
        onClick={(e) => {
          e.preventDefault();
          window.open(url, "_blank");
        }}
      >
        {url}
      </a>
      <LinkActionButtons url={url} onCopy={onCopy} />
    </div>
  );
}

interface SectionHeaderProps {
  title: string;
}

function SectionHeader({ title }: SectionHeaderProps) {
  return (
    <div className="flex items-baseline gap-3 mb-2">
      <h3 className="text-xs font-semibold text-white/50 uppercase tracking-wide min-w-fit">
        {title}
      </h3>
      <div className="h-px flex-1 bg-white/10 self-center" />
    </div>
  );
}

interface ValueRendererProps {
  value: unknown;
  onCopy: (text: string) => void;
}

function ValueRenderer({ value, onCopy }: ValueRendererProps): React.ReactNode {
  if (typeof value === "string") {
    if (isValidUrl(value)) {
      return <UrlDisplay url={value} onCopy={onCopy} />;
    }
    if (containsUrl(value)) {
      return (
        <p className="text-sm text-white/90 leading-relaxed whitespace-pre-wrap">
          <LinkifiedText text={value} />
        </p>
      );
    }
    return <p className="text-sm text-white/90 leading-relaxed whitespace-pre-wrap">{value}</p>;
  }

  if (Array.isArray(value)) {
    // Check if array contains objects (like multiple issues)
    if (value.length > 0 && typeof value[0] === "object" && value[0] !== null) {
      return (
        <div className="space-y-3">
          {value.map((item, index) => {
            const itemKey = `obj-${JSON.stringify(item).slice(0, 50)}-${index}`;
            return (
              <div key={itemKey} className="bg-white/5 p-4 rounded-md border border-white/10">
                <div className="space-y-3">
                  {Object.entries(item as Record<string, unknown>).map(([itemKey, itemValue]) => (
                    <div key={itemKey}>
                      <SectionHeader title={itemKey} />
                      <ValueRenderer value={itemValue} onCopy={onCopy} />
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      );
    }

    return (
      <div className="space-y-2">
        {value.map((item, index) => {
          const itemKey =
            typeof item === "string"
              ? `item-${item.slice(0, 50)}-${index}`
              : `item-${String(item).slice(0, 50)}-${index}`;
          return (
            <div key={itemKey}>
              <ValueRenderer value={item} onCopy={onCopy} />
            </div>
          );
        })}
      </div>
    );
  }

  if (typeof value === "object" && value !== null) {
    return (
      <pre className="text-xs font-mono text-white/70 whitespace-pre-wrap bg-white/5 p-3 rounded-md border border-white/10">
        {JSON.stringify(value, null, 2)}
      </pre>
    );
  }

  if (typeof value === "number") {
    return <span className="text-sm text-white/90 font-mono">{value}</span>;
  }

  return <span className="text-sm text-white/70">{String(value)}</span>;
}

interface StatusBadgeProps {
  status: "success" | "fail";
}

function StatusBadge({ status }: StatusBadgeProps) {
  const isSuccess = status === "success";
  return (
    <span
      className={`text-sm font-medium px-3 py-1.5 rounded-full ${
        isSuccess
          ? "bg-green-500/20 text-green-400 border border-green-500/30"
          : "bg-red-500/20 text-red-400 border border-red-500/30"
      }`}
    >
      {isSuccess ? "Success" : "Failed"}
    </span>
  );
}

const parseFinalOutput = (
  finalOutput: string | undefined,
): { parsed: ParsedResult | null; raw: string; isJson: boolean } => {
  if (!finalOutput) {
    return { parsed: null, raw: "", isJson: false };
  }

  const raw = typeof finalOutput === "string" ? finalOutput : JSON.stringify(finalOutput, null, 2);

  try {
    const parsed = typeof finalOutput === "string" ? JSON.parse(finalOutput) : finalOutput;
    return { parsed, raw, isJson: true };
  } catch {
    return { parsed: null, raw, isJson: false };
  }
};

const STEP_SUMMARY_CHAR_LIMIT = 1200;
const MERGED_INSTRUCTION_HEADER = "\n\n### Operator correction\n";

const truncateText = (text: string, limit = STEP_SUMMARY_CHAR_LIMIT) => {
  if (text.length <= limit) {
    return text;
  }
  return `${text.slice(0, limit)}... (truncated)`;
};

const formatValue = (value: unknown) => {
  if (value === undefined || value === null) {
    return "none";
  }
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

const summarizeSteps = (steps: MCPStep[]): string => {
  if (!steps.length) return "";
  return steps
    .map((step, index) => {
      const prefix = `${index + 1}.`;
      switch (step.type) {
        case "start":
          return `${prefix} START — ${step.message ?? "Workflow execution started."}`;
        case "reasoning": {
          if (!step.reasoning) return null;
          return `${prefix} REASONING — ${truncateText(step.reasoning)}`;
        }
        case "tool_call": {
          const argsText = step.args ? truncateText(formatValue(step.args)) : "No args provided.";
          return `${prefix} TOOL CALL — ${step.toolName ?? "unknown"} (server: ${step.serverName ?? "unknown"})\nArgs: ${argsText}`;
        }
        case "tool_result": {
          if (step.error) {
            return `${prefix} TOOL ERROR — ${step.error}`;
          }
          if (step.result === undefined) {
            return `${prefix} TOOL RESULT — No result payload returned.`;
          }
          return `${prefix} TOOL RESULT — ${truncateText(formatValue(step.result))}`;
        }
        case "final_result":
          return `${prefix} FINAL RESULT — ${step.message ?? "Generated final output."}`;
        default:
          return null;
      }
    })
    .filter((entry): entry is string => Boolean(entry))
    .join("\n");
};

const buildUndoPrompt = ({
  steps,
  finalOutput,
  intermediateOutput,
}: {
  steps: MCPStep[];
  finalOutput?: string;
  intermediateOutput?: string;
}) => {
  const sections: string[] = [
    "You previously executed an automated YakShaver task. I now need you to undo the effects of that run.",
  ];

  if (intermediateOutput) {
    sections.push(`Original operator brief / intermediate output:\n${intermediateOutput}`);
  }

  if (finalOutput) {
    sections.push(`Final output that must be reversed:\n${finalOutput}`);
  }

  const stepSummary = summarizeSteps(steps);
  if (stepSummary) {
    sections.push(`Recorded actions from the last run:\n${stepSummary}`);
  } else {
    sections.push("No granular step log is available. Undo any persisted changes created by the most recent run.");
  }

  sections.push(
    "Use the same MCP tools (and only those tools) to reverse those actions. Return a JSON summary describing the undo steps performed, tools used, and any follow-up required.",
  );

  return sections.join("\n\n");
};

const normalizeCorrections = (value: unknown): string[] => {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry));
  }
  return [String(value)];
};

const mergeReprocessInstructions = (base: string, extra: string): string => {
  const trimmedExtra = extra.trim();
  if (!trimmedExtra) return base;

  try {
    const parsed = JSON.parse(base) as Record<string, unknown>;
    const existingCorrections = normalizeCorrections(parsed.operatorCorrections);
    const merged = {
      ...parsed,
      operatorCorrections: [...existingCorrections, trimmedExtra],
      operatorCorrectionSummary:
        "Operator supplied additional guidance. Apply these corrections before executing tool calls.",
    };
    return JSON.stringify(merged, null, 2);
  } catch {
    return `${base.trim()}${MERGED_INSTRUCTION_HEADER}${trimmedExtra}\n\nPlease fully re-execute the MCP workflow (plan + tool calls) using these corrections.`;
  }
};

export function FinalResultPanel() {
  const [finalOutput, setFinalOutput] = useState<string | undefined>();
  const [intermediateOutput, setIntermediateOutput] = useState<string | undefined>();
  const [uploadResult, setUploadResult] = useState<WorkflowProgress["uploadResult"]>();
  const [mcpSteps, setMcpSteps] = useState<MCPStep[]>([]);
  const [reprocessDialogOpen, setReprocessDialogOpen] = useState(false);
  const [reprocessInstructions, setReprocessInstructions] = useState("");
  const [reprocessLoading, setReprocessLoading] = useState(false);
  const [reprocessError, setReprocessError] = useState<string | null>(null);
  const [reprocessSuccess, setReprocessSuccess] = useState<string | null>(null);
  const [undoLoading, setUndoLoading] = useState(false);
  const [undoError, setUndoError] = useState<string | null>(null);
  const [undoSuccess, setUndoSuccess] = useState<string | null>(null);

  const stageRef = useRef<WorkflowStage>(ProgressStage.IDLE);

  const resetForNewRun = useCallback(() => {
    setFinalOutput(undefined);
    setMcpSteps([]);
    setReprocessError(null);
    setReprocessSuccess(null);
    setUndoError(null);
    setUndoSuccess(null);
  }, []);

  useEffect(() => {
    return ipcClient.workflow.onProgress((data: unknown) => {
      const progressData = data as WorkflowProgress;
      const previousStage = stageRef.current;

      const isNewRecordingStage =
        progressData.stage === ProgressStage.CONVERTING_AUDIO &&
        previousStage !== ProgressStage.CONVERTING_AUDIO;

      const isRetryStage =
        progressData.stage === ProgressStage.EXECUTING_TASK &&
        previousStage !== ProgressStage.EXECUTING_TASK;

      if (isNewRecordingStage || isRetryStage) {
        resetForNewRun();
      }

      if (progressData.intermediateOutput) {
        setIntermediateOutput(progressData.intermediateOutput);
      }

      if (progressData.uploadResult) {
        setUploadResult(progressData.uploadResult);
      }

      if (typeof progressData.finalOutput !== "undefined") {
        setFinalOutput(progressData.finalOutput ?? undefined);
      }

      stageRef.current = progressData.stage;
    });
  }, [resetForNewRun]);

  useEffect(() => {
    return ipcClient.mcp.onStepUpdate((step) => {
      setMcpSteps((prev) => [...prev, { ...step, timestamp: Date.now() }]);
    });
  }, []);

  const handleReprocessDialogChange = useCallback((open: boolean) => {
    setReprocessDialogOpen(open);
    if (!open) {
      setReprocessInstructions("");
      setReprocessError(null);
      setReprocessSuccess(null);
    }
  }, []);

  const handleReprocess = useCallback(async () => {
    if (!intermediateOutput || !uploadResult) return;
    setReprocessLoading(true);
    setReprocessError(null);
    setReprocessSuccess(null);

    try {
      const mergedOutput = mergeReprocessInstructions(intermediateOutput, reprocessInstructions);
      const result = await ipcClient.pipelines.retryVideo(mergedOutput, uploadResult);

      if (!result?.success) {
        throw new Error(result?.error ?? "Reprocess failed");
      }

      setReprocessSuccess("Reprocess request finished. Review the refreshed workflow output.");
      setIntermediateOutput(mergedOutput);
    } catch (error) {
      setReprocessError(
        error instanceof Error ? error.message : "Failed to trigger reprocess request.",
      );
    } finally {
      setReprocessLoading(false);
    }
  }, [intermediateOutput, reprocessInstructions, uploadResult]);

  const handleUndo = useCallback(async () => {
    setUndoLoading(true);
    setUndoError(null);
    setUndoSuccess(null);

    try {
      const prompt = buildUndoPrompt({
        steps: mcpSteps,
        finalOutput,
        intermediateOutput,
      });
      await ipcClient.mcp.processMessage(prompt);
      setUndoSuccess("Undo request sent. Monitor the workflow panel for updates.");
    } catch (error) {
      setUndoError(error instanceof Error ? error.message : "Failed to trigger undo request.");
    } finally {
      setUndoLoading(false);
    }
  }, [finalOutput, intermediateOutput, mcpSteps, uploadResult]);

  if (!finalOutput) return null;

  const { parsed, raw, isJson } = parseFinalOutput(finalOutput);
  const status = (isJson && parsed?.Status) as "success" | "fail" | undefined;
  const showActions = status === "success";
  const canReprocess = showActions && Boolean(intermediateOutput && uploadResult);
  const canUndo = showActions && mcpSteps.length > 0;

  return (
    <div className="w-[500px] mx-auto my-4">
      <Card className="bg-black/30 backdrop-blur-sm border-white/20 shadow-xl">
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between">
            <CardTitle className="text-white text-2xl font-semibold">Final Result</CardTitle>
            {status && <StatusBadge status={status} />}
          </div>
        </CardHeader>
        <CardContent className="pt-2 space-y-6">
          {isJson && parsed ? (
            <JsonResultDisplay data={parsed} />
          ) : (
            <RawTextDisplay content={raw} />
          )}

          {showActions && (
            <div className="space-y-3">
              <div className="flex flex-col gap-3 sm:flex-row">
                <Dialog open={reprocessDialogOpen} onOpenChange={handleReprocessDialogChange}>
                  <DialogTrigger asChild>
                    <Button
                      variant="secondary"
                      disabled={!canReprocess || reprocessLoading}
                      className="flex-1"
                    >
                      {reprocessLoading ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <RotateCcw className="h-4 w-4" />
                      )}
                      Reprocess
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="bg-black/80 border-white/20 text-white">
                    <DialogHeader>
                      <DialogTitle className="text-white">Reprocess this yakshave</DialogTitle>
                      <DialogDescription className="text-white/70">
                        Provide corrective instructions for YakShaver, then submit to rerun the MCP
                        workflow.
                      </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-2">
                      <Label htmlFor="reprocess-instructions" className="text-white/80">
                        Additional instructions
                      </Label>
                      <Textarea
                        id="reprocess-instructions"
                        value={reprocessInstructions}
                        onChange={(event) => setReprocessInstructions(event.target.value)}
                        placeholder="Explain what needs to change. e.g. Wrong repo, please redo in xyz repo and use branch main."
                        disabled={reprocessLoading}
                        className="text-white placeholder:text-white/40 border-white/20 bg-white/5"
                      />
                      {reprocessError && (
                        <p className="text-sm text-red-300">{reprocessError}</p>
                      )}
                      {reprocessSuccess && (
                        <p className="text-sm text-green-300">{reprocessSuccess}</p>
                      )}
                    </div>
                    <DialogFooter>
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() => handleReprocessDialogChange(false)}
                        disabled={reprocessLoading}
                        className="text-white hover:text-white hover:bg-white/10"
                      >
                        Cancel
                      </Button>
                      <Button
                        type="button"
                        onClick={handleReprocess}
                        disabled={!canReprocess || reprocessLoading}
                      >
                        {reprocessLoading && <Loader2 className="h-4 w-4 animate-spin" />}
                        Run reprocess
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>

                <Button
                  variant="outline"
                  disabled={!canUndo || undoLoading}
                  onClick={handleUndo}
                  className="flex-1"
                >
                  {undoLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Undo2 className="h-4 w-4" />
                  )}
                  Undo
                </Button>
              </div>
              {undoError && <p className="text-sm text-red-400">{undoError}</p>}
              {undoSuccess && <p className="text-sm text-green-400">{undoSuccess}</p>}
              {!canUndo && showActions && (
                <p className="text-xs text-white/50">
                  Undo becomes available after YakShaver logs the tool calls for this run.
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
