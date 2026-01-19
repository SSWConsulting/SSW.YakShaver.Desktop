import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { ipcClient } from "../../services/ipc-client";
import { MCPStepType, ProgressStage, type WorkflowProgress } from "../../types";
import { deepParseJson, formatErrorMessage } from "../../utils";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { Button } from "../ui/button";
import { Label } from "../ui/label";
import { Textarea } from "../ui/textarea";

export function ApprovalDialog() {
  const [pendingToolApproval, setPendingToolApproval] = useState<{
    requestId: string;
    toolName?: string;
    args?: unknown;
    autoApproveAt?: number;
  } | null>(null);
  const [approvalSubmitting, setApprovalSubmitting] = useState(false);
  const [approvalError, setApprovalError] = useState<string | null>(null);
  const [autoApprovalCountdown, setAutoApprovalCountdown] = useState<number | null>(null);
  const [showCorrectionForm, setShowCorrectionForm] = useState(false);
  const [correctionText, setCorrectionText] = useState("");

  const isOpen = Boolean(pendingToolApproval);

  useEffect(() => {
    const unsubscribeProgress = ipcClient.workflow.onProgress((data: unknown) => {
      const progressData = data as WorkflowProgress;
      if (
        progressData.stage === ProgressStage.CONVERTING_AUDIO ||
        progressData.stage === ProgressStage.IDLE
      ) {
        setPendingToolApproval(null);
        setApprovalSubmitting(false);
        setApprovalError(null);
      }
    });

    const unsubscribeSteps = ipcClient.mcp.onStepUpdate((step) => {
      if (step.type === MCPStepType.TOOL_APPROVAL_REQUIRED && step.requestId) {
        setPendingToolApproval({
          requestId: step.requestId,
          toolName: step.toolName,
          args: step.args,
          autoApproveAt: step.autoApproveAt,
        });
        setApprovalError(null);
      }

      if (step.type === MCPStepType.TOOL_DENIED) {
        setPendingToolApproval((prev) => {
          if (!prev) {
            return prev;
          }
          if (!step.requestId || step.requestId === prev.requestId) {
            return null;
          }
          return prev;
        });
        setApprovalSubmitting(false);
      }
    });

    return () => {
      unsubscribeProgress();
      unsubscribeSteps();
    };
  }, []);

  type ApprovalAction =
    | { kind: "approve"; whitelist?: boolean }
    | { kind: "deny_stop"; feedback?: string }
    | { kind: "request_changes"; feedback: string };

  const resolveToolApproval = useCallback(
    async (action: ApprovalAction) => {
      if (!pendingToolApproval?.requestId) {
        return;
      }

      setApprovalSubmitting(true);
      setApprovalError(null);
      try {
        if (action.kind === "approve" && action.whitelist) {
          if (!pendingToolApproval.toolName) {
            throw new Error("Tool name missing for whitelist request.");
          }
          const whitelistResponse = await ipcClient.mcp.addToolToWhitelist(
            pendingToolApproval.toolName,
          );
          if (!whitelistResponse?.success) {
            throw new Error("Failed to add tool to whitelist.");
          }
        }

        const decisionPayload = (() => {
          if (action.kind === "request_changes") {
            const trimmed = action.feedback.trim();
            if (!trimmed) {
              throw new Error("Please describe what needs to change before retrying the tool.");
            }
            return { kind: action.kind, feedback: trimmed } as const;
          }
          if (action.kind === "deny_stop") {
            return action.feedback?.trim()
              ? { kind: action.kind, feedback: action.feedback.trim() }
              : { kind: action.kind };
          }
          return { kind: "approve" } as const;
        })();

        const result = await ipcClient.mcp.respondToToolApproval(
          pendingToolApproval.requestId,
          decisionPayload,
        );
        if (!result?.success) {
          throw new Error("Unable to submit tool approval decision.");
        }
        setPendingToolApproval(null);
      } catch (error) {
        setApprovalError(formatErrorMessage(error));
      } finally {
        setApprovalSubmitting(false);
      }
    },
    [pendingToolApproval],
  );

  useEffect(() => {
    if (!pendingToolApproval?.autoApproveAt || !pendingToolApproval.requestId) {
      setAutoApprovalCountdown(null);
      return;
    }

    const deadline = pendingToolApproval.autoApproveAt;
    const updateCountdown = () => {
      const remainingMs = deadline - Date.now();
      setAutoApprovalCountdown(Math.max(0, Math.ceil(remainingMs / 1000)));
    };

    updateCountdown();

    const intervalId = window.setInterval(updateCountdown, 500);
    const timeoutDelay = Math.max(0, deadline - Date.now());
    const timeoutId = window.setTimeout(() => {
      updateCountdown();
      void resolveToolApproval({ kind: "approve" });
    }, timeoutDelay);

    return () => {
      window.clearInterval(intervalId);
      window.clearTimeout(timeoutId);
    };
  }, [pendingToolApproval?.autoApproveAt, pendingToolApproval?.requestId, resolveToolApproval]);

  useEffect(() => {
    if (!isOpen) {
      setShowCorrectionForm(false);
      setCorrectionText("");
    }
  }, [isOpen]);

  if (!isOpen) {
    return null;
  }

  const approvalArgsText = pendingToolApproval?.args
    ? (() => {
        try {
          return JSON.stringify(deepParseJson(pendingToolApproval.args), null, 2);
        } catch {
          try {
            return JSON.stringify(pendingToolApproval.args, null, 2);
          } catch {
            return String(pendingToolApproval.args);
          }
        }
      })()
    : null;

  return (
    <AlertDialog open={isOpen}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {pendingToolApproval?.toolName
              ? `Allow ${pendingToolApproval.toolName}?`
              : "Approve requested tool?"}
          </AlertDialogTitle>
          <AlertDialogDescription>
            The orchestrator needs your confirmation before executing this MCP tool.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {autoApprovalCountdown !== null && (
          <p className="text-xs text-yellow-300">
            Auto-approving in {autoApprovalCountdown}s if no action is taken.
          </p>
        )}
        {approvalArgsText && (
          <div className="bg-black/30 border border-white/10 rounded-md max-h-48 overflow-y-auto">
            <pre className="text-xs text-white/80 p-3 whitespace-pre-wrap break-words">
              {approvalArgsText}
            </pre>
          </div>
        )}
        {approvalError && <p className="text-red-400 text-sm">{approvalError}</p>}
        {showCorrectionForm && (
          <div className="space-y-2">
            <div className="space-y-1">
              <Label htmlFor="tool-correction-text">Share corrections</Label>
              <Textarea
                id="tool-correction-text"
                rows={4}
                placeholder="Explain what needs to change before this tool runs again..."
                value={correctionText}
                onChange={(event) => setCorrectionText(event.target.value)}
                disabled={approvalSubmitting}
              />
            </div>
            <p className="text-xs text-white/60">
              Your note is added to the conversation so the AI can fix the tool inputs.
            </p>
          </div>
        )}
        <AlertDialogFooter className="flex flex-col gap-2 sm:flex-row sm:justify-end">
          {showCorrectionForm ? (
            <>
              <Button
                type="button"
                variant="ghost"
                disabled={approvalSubmitting}
                onClick={(event) => {
                  event.preventDefault();
                  setShowCorrectionForm(false);
                  setCorrectionText("");
                }}
              >
                Back
              </Button>
              <Button
                type="button"
                variant="destructive"
                disabled={approvalSubmitting}
                onClick={(event) => {
                  event.preventDefault();
                  void resolveToolApproval({
                    kind: "deny_stop",
                    feedback: correctionText.trim() || undefined,
                  });
                }}
              >
                {approvalSubmitting ? (
                  <span className="flex items-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Cancelling...
                  </span>
                ) : (
                  "Deny & stop"
                )}
              </Button>
              <Button
                type="button"
                disabled={approvalSubmitting || !correctionText.trim().length}
                onClick={(event) => {
                  event.preventDefault();
                  const trimmed = correctionText.trim();
                  if (!trimmed) {
                    return;
                  }
                  void resolveToolApproval({ kind: "request_changes", feedback: trimmed });
                }}
              >
                {approvalSubmitting ? (
                  <span className="flex items-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Sending...
                  </span>
                ) : (
                  "Send correction"
                )}
              </Button>
            </>
          ) : (
            <>
              <AlertDialogCancel
                disabled={approvalSubmitting}
                onClick={(event) => {
                  event.preventDefault();
                  setShowCorrectionForm(true);
                }}
              >
                Deny
              </AlertDialogCancel>
              <Button
                type="button"
                variant="secondary"
                disabled={approvalSubmitting || !pendingToolApproval?.toolName}
                onClick={(event) => {
                  event.preventDefault();
                  void resolveToolApproval({ kind: "approve", whitelist: true });
                }}
              >
                {approvalSubmitting ? (
                  <span className="flex items-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Saving...
                  </span>
                ) : (
                  "Approve & whitelist"
                )}
              </Button>
              <AlertDialogAction
                disabled={approvalSubmitting}
                onClick={(event) => {
                  event.preventDefault();
                  void resolveToolApproval({ kind: "approve" });
                }}
              >
                {approvalSubmitting ? (
                  <span className="flex items-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Processing...
                  </span>
                ) : (
                  "Approve once"
                )}
              </AlertDialogAction>
            </>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
