import type { WorkflowState, WorkflowStep } from "@shared/types/workflow";
import { CheckCircle2, ChevronDown, ChevronRight, Loader2, RefreshCw, XCircle } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { formatErrorMessage } from "@/utils";
import { ipcClient } from "../../services/ipc-client";
import type { MCPStep } from "../../types";
import { Button } from "../ui/button";
import { Card, CardContent } from "../ui/card";
import { isErrorStep, StageWithContent } from "./StageWithContent";

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
  return String(payload);
}

interface WorkflowStepCardProps {
  step: WorkflowStep;
  label: string;
  shaveId?: string;
}

export function WorkflowStepCard({ step, label, shaveId }: WorkflowStepCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);

  const { hasPayload, parsedPayload, hasStepErrors } = useMemo(() => {
    if (!step.payload) return { hasPayload: false, parsedPayload: null, hasStepErrors: false };

    try {
      const parsed = JSON.parse(step.payload);
      const isValid =
        parsed !== null && (typeof parsed === "object" ? Object.keys(parsed).length > 0 : true);

      return {
        hasPayload: isValid,
        parsedPayload: parsed,
        hasStepErrors: isValid && hasExecutingTaskErrors(step.stage, parsed),
      };
    } catch {
      return { hasPayload: !!step.payload, parsedPayload: step.payload, hasStepErrors: false };
    }
  }, [step.payload, step.stage]);

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
          </div>
        )}
      </div>

      {/* Error message + retry area below */}
      {isFailed && (errorMessage || shaveId) && (
        <CardContent className="p-0 pt-2">
          <div className="rounded bg-black/20 p-3 text-sm">
            <p className="text-red-400">An error occurred. Please check the details below.</p>
            {errorMessage && (
              <p className="mt-1 text-xs text-white/50 whitespace-pre-wrap break-all">
                {errorMessage}
              </p>
            )}
            {shaveId && (
              <div className="mt-3">
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={isRetrying}
                  onClick={handleRetry}
                  className="bg-white/[0.08] border border-white/[0.15] hover:bg-white/[0.12] text-white/80"
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
          </div>
        </CardContent>
      )}

      {/* Expandable details — non-failed payloads only */}
      {isExpanded && isExpandable && hasPayload && (
        <CardContent className="p-0 pt-2">
          <div className="overflow-x-auto rounded bg-black/20 p-2 text-white/80">
            <StageWithContent stage={step.stage} payload={parsedPayload} isError={false} />
          </div>
        </CardContent>
      )}
    </Card>
  );
}
