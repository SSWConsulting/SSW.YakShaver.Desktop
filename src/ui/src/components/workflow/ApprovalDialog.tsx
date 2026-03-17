import type { InteractionRequest, ToolApprovalPayload } from "@shared/types/user-interaction";
import { Server } from "lucide-react";
import { type ReactElement, useCallback, useEffect, useState } from "react";
import { ipcClient } from "../../services/ipc-client";
import { formatErrorMessage } from "../../utils";
import { LoadingState } from "../common/LoadingState";
import { AzureDevOpsIcon } from "../settings/mcp/devops/devops-icon";
import { GitHubIcon } from "../settings/mcp/github/github-icon";
import { AtlassianIcon } from "../settings/mcp/jira/atlassian";
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

function parseToolName(toolName: string): { server: string | null; tool: string } {
  const separatorIndex = toolName.indexOf("__");
  if (separatorIndex !== -1) {
    const server = toolName.slice(0, separatorIndex).replace(/_/g, " ");
    const tool = toolName.slice(separatorIndex + 2).replace(/_/g, " ");
    return { server, tool };
  }
  return { server: null, tool: toolName.replace(/_/g, " ") };
}

function getServiceIcon(serverName: string | null): ReactElement {
  const lower = serverName?.toLowerCase() ?? "";
  if (lower.includes("github")) {
    return <GitHubIcon className="w-8 h-8" />;
  }
  if (lower.includes("azure") || lower.includes("devops")) {
    return <AzureDevOpsIcon className="w-8 h-8" />;
  }
  if (lower.includes("jira") || lower.includes("atlassian")) {
    return <AtlassianIcon className="w-8 h-8" />;
  }
  return <Server className="w-8 h-8 text-white/70" />;
}

export function ApprovalDialog({ request, onSubmit, error: pError }: ApprovalDialogProps) {
  const payload = request.payload as ToolApprovalPayload;
  const { toolName } = payload;
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

  // Always open if we have a request
  const isOpen = true;

  const readableToolInfo = toolName ? parseToolName(toolName) : null;
  const dialogTitle = readableToolInfo
    ? `Allow "${readableToolInfo.tool}" to run?`
    : "Allow tool to run?";
  const dialogDescription = readableToolInfo?.server
    ? `The AI wants to run the "${readableToolInfo.tool}" tool from the ${readableToolInfo.server} server. Do you want to allow this?`
    : `The AI wants to run a tool. Do you want to allow this?`;

  return (
    <AlertDialog open={isOpen}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <div className="flex items-center gap-3">
            <div className="flex-shrink-0 w-8 h-8">
              {getServiceIcon(readableToolInfo?.server ?? null)}
            </div>
            <AlertDialogTitle>{dialogTitle}</AlertDialogTitle>
          </div>
          <AlertDialogDescription>{dialogDescription}</AlertDialogDescription>
        </AlertDialogHeader>
        {autoApprovalCountdown !== null && (
          <p className="text-xs text-yellow-300">
            Auto-approving in {autoApprovalCountdown}s if no action is taken.
          </p>
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
                Cancel
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
                    <LoadingState />
                    Cancelling...
                  </span>
                ) : (
                  "Don't Allow"
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
                    <LoadingState />
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
                Don't Allow
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
                    <LoadingState />
                    Saving...
                  </span>
                ) : (
                  "Allow Always"
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
                    <LoadingState />
                    Processing...
                  </span>
                ) : (
                  "Allow"
                )}
              </AlertDialogAction>
            </>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
