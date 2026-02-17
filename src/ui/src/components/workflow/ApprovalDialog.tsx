import type { InteractionRequest, ToolApprovalPayload } from "@shared/types/user-interaction";
import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { ipcClient } from "../../services/ipc-client";
import { formatErrorMessage } from "../../utils";
import { deepParseJson } from "../../utils";
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

interface ApprovalDialogProps {
  request: InteractionRequest;
  onSubmit: (data: unknown) => Promise<void>;
  error?: string | null;
}

export function ApprovalDialog({ request, onSubmit, error: pError }: ApprovalDialogProps) {
  const payload = request.payload as ToolApprovalPayload;
  const { toolName, args } = payload;
  const autoApproveAt = request.autoApproveAt;

  const [approvalSubmitting, setApprovalSubmitting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [autoApprovalCountdown, setAutoApprovalCountdown] = useState<number | null>(null);
  const [showCorrectionForm, setShowCorrectionForm] = useState(false);
  const [correctionText, setCorrectionText] = useState("");

  const displayError = pError || localError;

  // Reset internal state when request changes
  useEffect(() => {
    setApprovalSubmitting(false);
    setLocalError(null);
    setShowCorrectionForm(false);
    setCorrectionText("");
    setAutoApprovalCountdown(null);
  }, []);

  type ApprovalAction =
    | { kind: "approve"; whitelist?: boolean }
    | { kind: "deny_stop"; feedback?: string }
    | { kind: "request_changes"; feedback: string };

  const resolveToolApproval = useCallback(
    async (action: ApprovalAction) => {
      setApprovalSubmitting(true);
      setLocalError(null);
      try {
        if (action.kind === "approve" && action.whitelist) {
          if (!toolName) {
            throw new Error("Tool name missing for whitelist request.");
          }
          const whitelistResponse = await ipcClient.mcp.addToolToWhitelist(toolName);
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

        await onSubmit(decisionPayload);
      } catch (error) {
        setLocalError(formatErrorMessage(error));
        setApprovalSubmitting(false); // Only stop loading on error, otherwise allow parent to unmount
      }
    },
    [toolName, onSubmit],
  );

  useEffect(() => {
    if (!autoApproveAt) {
      setAutoApprovalCountdown(null);
      return;
    }

    const updateCountdown = () => {
      const remainingMs = autoApproveAt - Date.now();
      setAutoApprovalCountdown(Math.max(0, Math.ceil(remainingMs / 1000)));
    };

    updateCountdown();

    const intervalId = window.setInterval(updateCountdown, 500);
    const timeoutDelay = Math.max(0, autoApproveAt - Date.now());
    const timeoutId = window.setTimeout(() => {
      updateCountdown();
      void resolveToolApproval({ kind: "approve" });
    }, timeoutDelay);

    return () => {
      window.clearInterval(intervalId);
      window.clearTimeout(timeoutId);
    };
  }, [autoApproveAt, resolveToolApproval]);

  useEffect(() => {
    // Reset form when request changes
    setShowCorrectionForm(false);
    setCorrectionText("");
  }, []);

  // Always open if we have a request
  const isOpen = true;

  const approvalArgsText = args
    ? (() => {
        try {
          return JSON.stringify(deepParseJson(args), null, 2);
        } catch {
          try {
            return JSON.stringify(args, null, 2);
          } catch {
            return String(args);
          }
        }
      })()
    : null;

  return (
    <AlertDialog open={isOpen}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {toolName ? `Allow ${toolName}?` : "Approve requested tool?"}
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
        {displayError && <p className="text-red-400 text-sm">{displayError}</p>}
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
                disabled={approvalSubmitting || !toolName}
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
