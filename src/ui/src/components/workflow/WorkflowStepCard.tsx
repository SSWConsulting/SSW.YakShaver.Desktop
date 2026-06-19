import type { WorkflowState, WorkflowStep } from "@shared/types/workflow";
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
import { formatErrorMessage } from "@/utils";
import { ipcClient } from "../../services/ipc-client";
import type { MCPStep } from "../../types";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card, CardContent } from "../ui/card";
import { isErrorStep, StageWithContent } from "./StageWithContent";

/**
 * Reads the active orchestrator that drove the Executing Task stage from its parsed payload.
 * Stamped backend-side at stage start (see ExecutingTaskPayload.orchestrator).
 */
function getOrchestratorBackend(stage: string, parsed: unknown): "openai" | "claude-code" | null {
  if (stage !== "executing_task" || !isRecord(parsed)) return null;
  const backend = parsed.orchestrator;
  return backend === "claude-code" || backend === "openai" ? backend : null;
}

/**
 * A distinct pill marking the Executing Task stage as driven by the local Claude Code orchestrator,
 * so the user clearly sees it even when Claude's live reasoning is terse.
 */
function OrchestratorBadge({ backend }: { backend: "openai" | "claude-code" }) {
  if (backend === "claude-code") {
    return (
      <Badge
        variant="outline"
        className="border-amber-400/40 bg-amber-400/10 text-amber-300"
        title="Orchestrated by the Claude Code CLI on this machine — uses your Claude Code sign-in, no API key"
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

  // Only non-failed states get expand/collapse for payload
  const isExpandable = !isFailed && hasPayload;

  const config =
    STATUS_CONFIG[effectiveStatus as keyof typeof STATUS_CONFIG] || STATUS_CONFIG.not_started;

  const toggleExpand = () => {
    if (isExpandable) setIsExpanded(!isExpanded);
  };

  const handleRetry = async () => {
    if (!shaveId) return;

    setIsRetrying(true);
    try {
      const result = await ipcClient.workflow.retryFromStage(
        step.stage as keyof WorkflowState,
        shaveId,
      );
      if (!result?.success) {
        throw new Error(result?.error || "Retry failed");
      }
    } catch (error) {
      toast.error("Retry failed", {
        description: formatErrorMessage(error),
      });
    } finally {
      setIsRetrying(false);
    }
  };

  const errorMessage = isFailed ? extractErrorMessage(parsedPayload) : null;

  return (
    <Card className={cn("rounded-lg p-3 gap-0 transition-all", config.containerClass)}>
      {/* Header row */}
      <div className="flex items-center gap-3">
        {isExpandable ? (
          <Button
            variant="ghost"
            onClick={toggleExpand}
            className="h-auto flex-1 justify-between p-0 text-base hover:bg-transparent hover:text-current dark:hover:bg-transparent"
            aria-expanded={isExpanded}
          >
            <div className="flex items-center gap-3 flex-1">
              <StatusIcon status={effectiveStatus} />
              <span className={cn("font-medium", config.textClass)}>{label}</span>
              {orchestratorBackend && <OrchestratorBadge backend={orchestratorBackend} />}
            </div>
            <div className="text-white/50 hover:text-white/90">
              {isExpanded ? (
                <ChevronDown className="size-4" />
              ) : (
                <ChevronRight className="size-4" />
              )}
            </div>
          </Button>
        ) : (
          <div className="flex items-center gap-3 flex-1">
            <StatusIcon status={effectiveStatus} />
            <span className={cn("font-medium", config.textClass)}>{label}</span>
            {orchestratorBackend && <OrchestratorBadge backend={orchestratorBackend} />}
          </div>
        )}
        {step.status === "failed" && shaveId && (
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
      </div>

      {/* Error content area — always visible for failed cards */}
      {isFailed && hasStructuredSteps && hasPayload && (
        <CardContent className="p-0 pt-2">
          <div className="overflow-x-auto rounded bg-black/20 p-2 text-white/80">
            <StageWithContent stage={step.stage} payload={parsedPayload} />
          </div>
        </CardContent>
      )}
      {isFailed && !hasStructuredSteps && errorMessage && (
        <CardContent className="p-0 pt-2">
          <div className="rounded bg-black/20 p-3 text-sm">
            <p className="text-red-400">An error occurred. Please check the details below.</p>
            <p className="mt-1 text-xs text-white/50 whitespace-pre-wrap break-all">
              {errorMessage}
            </p>
          </div>
        </CardContent>
      )}

      {/* Expandable details — non-failed payloads only */}
      {isExpanded && isExpandable && hasPayload && (
        <CardContent className="p-0 pt-2">
          <div className="overflow-x-auto rounded bg-black/20 p-2 text-white/80">
            <StageWithContent stage={step.stage} payload={parsedPayload} />
          </div>
        </CardContent>
      )}
    </Card>
  );
}
