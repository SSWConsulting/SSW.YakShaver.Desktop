import { Copy, ExternalLink, Loader2, RotateCcw, Undo2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { formatErrorMessage } from "@/utils";
import { useClipboard } from "../../hooks/useClipboard";
import { ipcClient } from "../../services/ipc-client";
import {
  type MCPStep,
  MCPStepType,
  ProgressStage,
  type WorkflowProgress,
  type WorkflowStage,
} from "../../types";
import { UNDO_EVENT_CHANNEL, type UndoEventDetail } from "../../types/index";
import { Button } from "../ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
  const trimmed = str.trim();
  // Ensure the entire string is just a URL (no spaces, newlines, or additional text)
  if (trimmed.includes(" ") || trimmed.includes("\n")) {
    return false;
  }
  try {
    new URL(trimmed);
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

  // Parse and restructure the data to separate label patterns like "Type: Bug"
  const processedData: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(data)) {
    if (key === "Status" || key === "IssueNumber") continue;

    // Special handling for Labels array
    if (key === "Labels" && Array.isArray(value)) {
      const regularLabels: string[] = [];

      for (const label of value) {
        if (typeof label === "string" && label.includes(":")) {
          // Parse "Type: Bug" pattern
          const [labelKey, ...labelValueParts] = label.split(":");
          const labelValue = labelValueParts.join(":").trim();
          if (labelKey && labelValue) {
            processedData[labelKey.trim()] = labelValue;
            continue;
          }
        }
        regularLabels.push(String(label));
      }

      if (regularLabels.length > 0) {
        processedData.Labels = regularLabels;
      }
    } else {
      processedData[key] = value;
    }
  }

  const entries = Object.entries(processedData);

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

    // Check if all items are simple strings without URLs (like labels/tags)
    const allSimpleStrings = value.every(
      (item) => typeof item === "string" && !isValidUrl(item) && !containsUrl(item),
    );

    if (allSimpleStrings) {
      return (
        <div className="flex flex-wrap gap-2">
          {value.map((item, index) => (
            <span
              key={`tag-${String(item).slice(0, 50)}-${index}`}
              className="text-sm text-white/90 leading-relaxed whitespace-pre-wrap"
            >
              {String(item)}
            </span>
          ))}
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
const REPROCESS_MODES = {
  original: {
    title: "Reprocess this yakshave",
    description:
      "Provide corrective instructions for YakShaver, then submit to rerun the MCP workflow.",
    placeholder:
      "Explain what needs to change. e.g. Wrong repo, please redo in xyz repo and use branch main.",
    success: "Reprocess request finished. Review the refreshed workflow output.",
  },
  undo: {
    title: "Rerun undo workflow",
    description: "Add guidance for YakShaver before it attempts to undo the previous run again.",
    placeholder: "Explain what went wrong when undoing. e.g. Close issue instead of deleting.",
    success: "Undo reprocess request finished. Review the undo panel for updates.",
  },
} as const;

type ReprocessMode = keyof typeof REPROCESS_MODES;

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
        case MCPStepType.START:
          return `${prefix} START — ${step.message ?? "Workflow execution started."}`;
        case MCPStepType.REASONING: {
          if (!step.reasoning) return null;
          return `${prefix} REASONING — ${truncateText(step.reasoning)}`;
        }
        case MCPStepType.TOOL_CALL: {
          const argsText = step.args ? truncateText(formatValue(step.args)) : "No args provided.";
          return `${prefix} TOOL CALL — ${step.toolName ?? "unknown"} (server: ${step.serverName ?? "unknown"})\nArgs: ${argsText}`;
        }
        case MCPStepType.TOOL_RESULT: {
          if (step.error) {
            return `${prefix} TOOL ERROR — ${step.error}`;
          }
          if (step.result === undefined) {
            return `${prefix} TOOL RESULT — No result payload returned.`;
          }
          return `${prefix} TOOL RESULT — ${truncateText(formatValue(step.result))}`;
        }
        case MCPStepType.TOOL_APPROVAL_REQUIRED:
          return `${prefix} TOOL APPROVAL — Awaiting permission to run ${step.toolName ?? "unknown tool"}.`;
        case MCPStepType.TOOL_DENIED:
          return `${prefix} TOOL DENIED — ${step.message ?? "Operator cancelled the tool call."}`;
        case MCPStepType.FINAL_RESULT:
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
    sections.push(
      "No granular step log is available. Undo any persisted changes created by the most recent run.",
    );
  }

  sections.push(
    "Use the same MCP tools (and only those tools) to reverse those actions. Return a JSON summary describing the undo steps performed, tools used, and any follow-up required.",
  );

  return sections.join("\n\n");
};

const normalizeCorrections = (value: unknown): string[] => {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.map((entry) => {
      if (typeof entry === "string") return entry;
      if (typeof entry === "object" && entry !== null) return JSON.stringify(entry);
      return String(entry);
    });
  }
  if (typeof value === "string") return [value];
  if (typeof value === "object" && value !== null) return [JSON.stringify(value)];
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

const mergeUndoPrompt = (base: string, extra: string): string => {
  const trimmedExtra = extra.trim();
  if (!trimmedExtra) return base;
  return `${base}\n\nOperator note:\n${trimmedExtra}`;
};

const emitUndoEvent = (type: UndoEventDetail["type"]) => {
  window.dispatchEvent(new CustomEvent(UNDO_EVENT_CHANNEL, { detail: { type } }));
};

export function FinalResultPanel() {
  const [finalOutput, setFinalOutput] = useState<string | undefined>();
  const [intermediateOutput, setIntermediateOutput] = useState<string | undefined>();
  const [uploadResult, setUploadResult] = useState<WorkflowProgress["uploadResult"]>();
  const [mcpSteps, setMcpSteps] = useState<MCPStep[]>([]);
  const [reprocessDialogOpen, setReprocessDialogOpen] = useState(false);
  const [reprocessMode, setReprocessMode] = useState<ReprocessMode>("original");
  const [reprocessInstructions, setReprocessInstructions] = useState("");
  const [reprocessLoading, setReprocessLoading] = useState(false);
  const [reprocessError, setReprocessError] = useState<string | null>(null);
  const [undoLoading, setUndoLoading] = useState(false);
  const [undoError, setUndoError] = useState<string | null>(null);
  const [hasUndoCompleted, setHasUndoCompleted] = useState(false);
  const [lastUndoPrompt, setLastUndoPrompt] = useState<string | null>(null);

  const stageRef = useRef<WorkflowStage>(ProgressStage.IDLE);

  const resetForNewRun = useCallback(() => {
    setFinalOutput(undefined);
    setMcpSteps([]);
    setReprocessError(null);
    setUndoError(null);
    setHasUndoCompleted(false);
    setLastUndoPrompt(null);
    emitUndoEvent("reset");
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
      setReprocessMode("original");
    }
  }, []);

  const openReprocessDialog = (mode: ReprocessMode) => {
    setReprocessMode(mode);
    setReprocessDialogOpen(true);
  };

  const handleReprocessOriginal = useCallback(async () => {
    if (!intermediateOutput || !uploadResult) return;
    setReprocessLoading(true);
    setReprocessError(null);

    try {
      const mergedOutput = mergeReprocessInstructions(intermediateOutput, reprocessInstructions);
      const result = await ipcClient.pipelines.retryVideo(mergedOutput, uploadResult);

      if (!result?.success) {
        throw new Error(result?.error ?? "Reprocess failed");
      }

      setIntermediateOutput(mergedOutput);
      setReprocessDialogOpen(false);
      toast.success("Reprocess request sent. Watch the workflow panel for updates.");
    } catch (error) {
      setReprocessError(formatErrorMessage(error));
    } finally {
      setReprocessLoading(false);
    }
  }, [intermediateOutput, reprocessInstructions, uploadResult]);

  const handleReprocessUndo = useCallback(async () => {
    if (!lastUndoPrompt) {
      setReprocessError("Undo history not available yet.");
      return;
    }
    setReprocessLoading(true);
    setReprocessError(null);

    try {
      emitUndoEvent("start");
      const mergedPrompt = mergeUndoPrompt(lastUndoPrompt, reprocessInstructions);
      await ipcClient.mcp.processMessage(mergedPrompt);
      emitUndoEvent("complete");
      setLastUndoPrompt(mergedPrompt);
      setReprocessDialogOpen(false);
      toast.success("Undo reprocess request sent. Monitor the purple undo panel.");
    } catch (error) {
      emitUndoEvent("error");
      setReprocessError(formatErrorMessage(error));
    } finally {
      setReprocessLoading(false);
    }
  }, [lastUndoPrompt, reprocessInstructions]);

  const handleUndo = useCallback(async () => {
    setUndoLoading(true);
    setUndoError(null);

    try {
      const prompt = buildUndoPrompt({
        steps: mcpSteps,
        finalOutput,
        intermediateOutput,
      });
      setLastUndoPrompt(prompt);
      emitUndoEvent("start");
      await ipcClient.mcp.processMessage(prompt);
      emitUndoEvent("complete");
      setHasUndoCompleted(true);
      toast.success("Undo workflow running. Check the purple undo panel.");
    } catch (error) {
      emitUndoEvent("error");
      setUndoError(formatErrorMessage(error));
    } finally {
      setUndoLoading(false);
    }
  }, [finalOutput, intermediateOutput, mcpSteps]);

  const handleReprocess = useCallback(async () => {
    if (reprocessMode === "original") {
      await handleReprocessOriginal();
    } else {
      await handleReprocessUndo();
    }
  }, [handleReprocessOriginal, handleReprocessUndo, reprocessMode]);

  if (!finalOutput) return null;

  const { parsed, raw, isJson } = parseFinalOutput(finalOutput);
  const status = (isJson && parsed?.Status) as "success" | "fail" | undefined;
  const showActions = Boolean(finalOutput);
  const canReprocessOriginal = showActions && Boolean(intermediateOutput && uploadResult);
  const canReprocessUndo = hasUndoCompleted && Boolean(lastUndoPrompt);
  const canUndo = showActions && !hasUndoCompleted && mcpSteps.length > 0;
  const dialogCopy = REPROCESS_MODES[reprocessMode];

  return (
    <div className="w-[500px] mx-auto my-4">
      <Card className="bg-black/30 backdrop-blur-sm border-white/20 shadow-xl">
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between">
            <CardTitle className="text-2xl font-semibold">Final Result</CardTitle>
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
                <Button
                  variant="secondary"
                  disabled={!canReprocessOriginal || reprocessLoading}
                  className="flex-1"
                  onClick={() => openReprocessDialog("original")}
                >
                  {reprocessLoading && reprocessMode === "original" ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <RotateCcw className="h-4 w-4" />
                  )}
                  {hasUndoCompleted ? "Reprocess original shave" : "Reprocess"}
                </Button>

                {hasUndoCompleted ? (
                  <Button
                    variant="secondary"
                    disabled={!canReprocessUndo || reprocessLoading}
                    className="flex-1"
                    onClick={() => openReprocessDialog("undo")}
                  >
                    {reprocessLoading && reprocessMode === "undo" ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <RotateCcw className="h-4 w-4" />
                    )}
                    Reprocess undo
                  </Button>
                ) : (
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
                )}
              </div>
              <Dialog open={reprocessDialogOpen} onOpenChange={handleReprocessDialogChange}>
                <DialogContent className="bg-black/95 border-white/20 text-white">
                  <DialogHeader>
                    <DialogTitle className="text-white">{dialogCopy.title}</DialogTitle>
                    <DialogDescription className="text-white/70">
                      {dialogCopy.description}
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-2">
                    <Label htmlFor="reprocess-instructions" className="text-white/80">
                      Additional instructions
                    </Label>
                    <Textarea
                      value={reprocessInstructions}
                      onChange={(event) => setReprocessInstructions(event.target.value)}
                      placeholder={dialogCopy.placeholder}
                      disabled={reprocessLoading}
                      className="text-white placeholder:text-white/40 border-white/20 bg-white/5"
                    />
                    {reprocessError && <p className="text-sm text-red-300">{reprocessError}</p>}
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
                    <Button type="button" onClick={handleReprocess} disabled={reprocessLoading}>
                      {reprocessLoading && <Loader2 className="h-4 w-4 animate-spin" />}
                      Run reprocess
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>

              {undoError && <p className="text-sm text-red-400">{undoError}</p>}
              {!canUndo && showActions && !hasUndoCompleted && (
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
