import type { WorkflowState, WorkflowStep } from "@shared/types/workflow";
import type { OrchestratorBackend } from "@shared/types/workflow-payloads";
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Loader2,
  RefreshCw,
  Sparkles,
  XCircle,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { formatErrorMessage, isErrorStep } from "@/utils";
import { ipcClient } from "../../services/ipc-client";
import type { MCPStep } from "../../types";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card, CardContent } from "../ui/card";
import { StageWithContent } from "./StageWithContent";

/**
 * Reads the active orchestrator that drove the Executing Task stage from its parsed payload.
 * Stamped backend-side at stage start (see ExecutingTaskPayload.orchestrator).
 */
function getOrchestratorBackend(stage: string, parsed: unknown): OrchestratorBackend | null {
  if (stage !== "executing_task" || !isRecord(parsed)) return null;
  const backend = parsed.orchestrator;
  return backend === "claude-code" || backend === "openai" ? backend : null;
}

/**
 * A distinct pill marking the Executing Task stage as driven by the local Claude Code orchestrator,
 * so the user clearly sees it even when Claude's live reasoning is terse.
 */
function OrchestratorBadge({ backend }: { backend: OrchestratorBackend }) {
  if (backend === "claude-code") {
    return (
      <Badge
        variant="outline"
        className="border-amber-400/40 bg-amber-400/10 text-amber-300"
        title="Orchestrated by the Claude Code CLI on this machine — uses your Claude Code sign-in instead of an Anthropic API key"
      >
        <Sparkles className="size-3" />
        Claude Code
      </Badge>
    );
  }
  return (
    <Badge
      variant="outline"
      className="border-white/15 bg-white/5 text-white/50"
      title="OpenAI orchestrator"
    >
      OpenAI
    </Badge>
  );
}

const STATUS_CONFIG = {
  in_progress: {
    icon: Loader2,
    iconClass: "animate-spin text-zinc-300",
    containerClass: "border-gray-500/30 bg-gray-500/5",
    textClass: "text-white/90",
  },
  completed: {
    icon: CheckCircle2,
    iconClass: "text-green-400",
    containerClass: "border-green-500/30 bg-green-500/5",
    textClass: "text-white/90",
  },
  failed: {
    icon: XCircle,
    iconClass: "text-red-400",
    containerClass: "border-red-500/30 bg-red-500/5",
    textClass: "text-white/90",
  },
  not_started: {
    icon: null,
    iconClass: "",
    containerClass: "border-white/10 bg-black/20",
    textClass: "text-white/30",
  },
} as const;

function StatusIcon({ status, className }: { status: WorkflowStep["status"]; className?: string }) {
  const config = STATUS_CONFIG[status as keyof typeof STATUS_CONFIG] || STATUS_CONFIG.not_started;
  const Icon = config.icon;

  if (!Icon) {
    return <div className={cn("size-5 rounded-full border-2 border-white/20", className)} />;
  }

  return <Icon className={cn("size-5", config.iconClass, className)} />;
}

function hasExecutingTaskErrors(stage: string, parsed: unknown): boolean {
  return (
    stage === "executing_task" &&
    typeof parsed === "object" &&
    parsed !== null &&
    Array.isArray((parsed as Record<string, unknown>).steps) &&
    ((parsed as Record<string, unknown>).steps as MCPStep[]).some(isErrorStep)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function extractErrorMessage(payload: unknown): string | null {
  if (!payload) return null;
  if (typeof payload === "string") return payload;
  if (isRecord(payload)) {
    if (typeof payload.error === "string") return payload.error;
    if (typeof payload.message === "string") return payload.message;
    if (payload.error) return JSON.stringify(payload.error, null, 2);
  }
  return JSON.stringify(payload, null, 2);
}

interface WorkflowStepCardProps {
  step: WorkflowStep;
  label: string;
  shaveId?: string;
}

export function WorkflowStepCard({ step, label, shaveId }: WorkflowStepCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);
  // #698: only the Executing Task stage can usefully take a custom retry prompt — it's the
  // stage that drives the AI agent loop, so a more specific prompt can steer it away from
  // whatever got it stuck (e.g. a timeout from retrying a tool/resource that doesn't exist).
  const [showPromptInput, setShowPromptInput] = useState(false);
  const [customPrompt, setCustomPrompt] = useState("");

  const { hasPayload, parsedPayload, hasStepErrors, hasStructuredSteps } = useMemo(() => {
    if (!step.payload)
      return {
        hasPayload: false,
        parsedPayload: null,
        hasStepErrors: false,
        hasStructuredSteps: false,
      };

    try {
      const parsed = JSON.parse(step.payload);
      const isValid =
        parsed !== null && (typeof parsed === "object" ? Object.keys(parsed).length > 0 : true);

      const structuredSteps =
        isValid &&
        step.stage === "executing_task" &&
        typeof parsed === "object" &&
        parsed !== null &&
        Array.isArray((parsed as Record<string, unknown>).steps);

      return {
        hasPayload: isValid,
        parsedPayload: parsed,
        hasStepErrors: isValid && hasExecutingTaskErrors(step.stage, parsed),
        hasStructuredSteps: structuredSteps,
      };
    } catch {
      return {
        hasPayload: !!step.payload,
        parsedPayload: step.payload,
        hasStepErrors: false,
        hasStructuredSteps: false,
      };
    }
  }, [step.payload, step.stage]);

  const orchestratorBackend = getOrchestratorBackend(step.stage, parsedPayload);

  const effectiveStatus: WorkflowStep["status"] =
    hasStepErrors && step.status === "completed" ? "failed" : step.status;

  const isFailed = effectiveStatus === "failed";

  if (step.status === "skipped") return null;

  // #523: failed steps are expandable too (when they carry a payload) so the error
  // detail is opt-in via the same click-to-expand affordance as other rows, instead
  // of always rendering a prominent red block for a collapsed row.
  const isExpandable = hasPayload;

  const errorMessage = isFailed ? extractErrorMessage(parsedPayload) : null;

  // #974 review: a single shared condition for "there is error detail behind the
  // expand toggle", used by both the expanded CardContent block below and the
  // collapsed-row hint, so the two can never independently drift out of sync.
  const hasErrorDetail =
    isFailed && ((hasStructuredSteps && hasPayload) || (!hasStructuredSteps && !!errorMessage));

  const config =
    STATUS_CONFIG[effectiveStatus as keyof typeof STATUS_CONFIG] || STATUS_CONFIG.not_started;

  const toggleExpand = () => {
    if (isExpandable) setIsExpanded(!isExpanded);
  };

  const isExecutingTaskStage = step.stage === "executing_task";

  const handleRetry = async () => {
    if (!shaveId) return;

    setIsRetrying(true);
    try {
      const result = await ipcClient.workflow.retryFromStage(
        step.stage as keyof WorkflowState,
        shaveId,
        isExecutingTaskStage ? customPrompt.trim() || undefined : undefined,
      );
      if (!result?.success) {
        throw new Error(result?.error || "Retry failed");
      }
      setShowPromptInput(false);
      setCustomPrompt("");
    } catch (error) {
      toast.error("Retry failed", {
        description: formatErrorMessage(error),
      });
    } finally {
      setIsRetrying(false);
    }
  };

  return (
    <Card className={cn("rounded-lg p-3 gap-0 transition-all", config.containerClass)}>
      {/* Header row */}
      <div className="flex items-center gap-3">
        {/* #974 review: the header is always a <Button>, whether or not the row is
            currently expandable — toggling isExpandable used to swap the element type
            between <Button> and <div> at this DOM position, which forces React to
            unmount/remount the subtree (dropping focus/hover) every time. Disabling it
            keeps identity stable across renders and removes that as a flicker source. */}
        <Button
          variant="ghost"
          onClick={toggleExpand}
          disabled={!isExpandable}
          className="h-auto flex-1 justify-between p-0 text-base hover:bg-transparent hover:text-current dark:hover:bg-transparent disabled:opacity-100 disabled:pointer-events-auto disabled:cursor-default"
          aria-expanded={isExpandable ? isExpanded : undefined}
        >
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <StatusIcon status={effectiveStatus} />
            <span className="flex shrink-0 items-center gap-1">
              <span className={cn("font-medium", config.textClass)}>{label}</span>
              {/* Keep the visual affordance out of the accessible label. */}
              {isExpandable && (
                <span aria-hidden="true" className={config.textClass}>
                  &hellip;
                </span>
              )}
            </span>
            {orchestratorBackend && <OrchestratorBadge backend={orchestratorBackend} />}
            {isFailed && (
              <span className="sr-only">
                {hasErrorDetail ? "Error. Expand for details." : "Error."}
              </span>
            )}
          </div>
          {isExpandable && (
            <div className="text-white/50 hover:text-white/90">
              {isExpanded ? (
                <ChevronDown className="size-4" />
              ) : (
                <ChevronRight className="size-4" />
              )}
            </div>
          )}
        </Button>
        {step.status === "failed" && shaveId && !showPromptInput && (
          <Button
            size="sm"
            variant="ghost"
            disabled={isRetrying}
            onClick={handleRetry}
            className="bg-white/[0.08] border border-white/[0.15] hover:bg-white/[0.12] text-white/80 shrink-0"
          >
            {isRetrying ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <>
                <RefreshCw className="size-3.5 mr-1.5" />
                Retry
              </>
            )}
          </Button>
        )}
        {step.status === "failed" && shaveId && isExecutingTaskStage && !showPromptInput && (
          <Button
            size="sm"
            variant="ghost"
            disabled={isRetrying}
            onClick={() => setShowPromptInput(true)}
            className="bg-white/[0.08] border border-white/[0.15] hover:bg-white/[0.12] text-white/60 shrink-0"
            title="Retry with a custom prompt"
          >
            <Sparkles className="size-3.5" />
          </Button>
        )}
      </div>

      {/* #698: optional custom prompt for retrying the Executing Task stage after a failure
          (e.g. a timeout) — lets the user steer the retry instead of repeating the exact same
          run that got stuck. */}
      {step.status === "failed" && shaveId && isExecutingTaskStage && showPromptInput && (
        <div className="mt-2 flex items-center gap-2">
          <input
            type="text"
            value={customPrompt}
            onChange={(e) => setCustomPrompt(e.target.value)}
            placeholder="Optional: add instructions for the retry"
            disabled={isRetrying}
            className="h-8 flex-1 min-w-0 rounded border border-white/[0.15] bg-black/20 px-2 text-sm text-white/90 placeholder:text-white/30 focus:outline-none focus:border-white/30"
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleRetry();
            }}
          />
          <Button
            size="sm"
            variant="ghost"
            disabled={isRetrying}
            onClick={handleRetry}
            className="bg-white/[0.08] border border-white/[0.15] hover:bg-white/[0.12] text-white/80 shrink-0"
          >
            {isRetrying ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <>
                <RefreshCw className="size-3.5 mr-1.5" />
                Retry
              </>
            )}
          </Button>
        </div>
      )}

      {/* #523: error/detail content only renders once the row is expanded — a failed
          row is no longer forced open, so its error stays subtle (see the inline hint
          above) until the user opts in. This also removes the flicker previously caused
          by the always-on block snapping open/closed as executing_task's live payload
          toggled effectiveStatus between "failed" and "completed". Both branches below
          share the hasErrorDetail condition with the collapsed hint above so the two
          can't drift apart. */}
      {isExpanded && hasErrorDetail && hasStructuredSteps && (
        <CardContent className="p-0 pt-2">
          <div className="overflow-x-auto rounded bg-black/20 p-2 text-white/80">
            <StageWithContent stage={step.stage} payload={parsedPayload} />
          </div>
        </CardContent>
      )}
      {isExpanded && hasErrorDetail && !hasStructuredSteps && (
        <CardContent className="p-0 pt-2">
          <div className="rounded bg-black/20 p-3 text-sm">
            <p className="text-red-400">An error occurred. Please check the details below.</p>
            <p className="mt-1 text-xs text-white/50 whitespace-pre-wrap break-all">
              {errorMessage}
            </p>
          </div>
        </CardContent>
      )}

      {/* Expandable details — non-failed payloads */}
      {isExpanded && isExpandable && !isFailed && hasPayload && (
        <CardContent className="p-0 pt-2">
          <div className="overflow-x-auto rounded bg-black/20 p-2 text-white/80">
            <StageWithContent stage={step.stage} payload={parsedPayload} />
          </div>
        </CardContent>
      )}
    </Card>
  );
}
