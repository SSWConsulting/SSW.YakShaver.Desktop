import type { InteractionRequest, ToolApprovalPayload } from "@shared/types/user-interaction";
import { Terminal } from "lucide-react";
import { type ReactElement, useCallback, useEffect, useState } from "react";
import { ipcClient } from "../../services/ipc-client";
import { formatErrorMessage, parseToolName } from "../../utils";
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
function getServiceIcon(serverName: string | null): ReactElement {
  const lower = serverName?.toLowerCase() ?? "";
  if (lower.includes("github")) {
    return <GitHubIcon className="w-5 h-5" />;
  }
  if (lower.includes("azure") || lower.includes("devops")) {
    return <AzureDevOpsIcon className="w-5 h-5" />;
  }
  if (lower.includes("jira") || lower.includes("atlassian")) {
    return <AtlassianIcon className="w-5 h-5" />;
  }
  return <Terminal className="w-5 h-5 text-white/70" />;
}

/**
 * Extracts the raw, unformatted tool id from a prefixed MCP tool name, i.e. the
 * segment after the server prefix. Handles both the "__" (MCP system) and "."
 * (AI output) separators, e.g. "Yak_Video_Tools__capture_video_frame" and
 * "Yak_Video_Tools.capture_video_frame" both yield "capture_video_frame".
 */
function rawToolId(rawToolName: string): string {
  const dunderIndex = rawToolName.indexOf("__");
  if (dunderIndex !== -1) {
    return rawToolName.slice(dunderIndex + 2);
  }
  const dotIndex = rawToolName.indexOf(".");
  if (dotIndex !== -1) {
    return rawToolName.slice(dotIndex + 1);
  }
  return rawToolName;
}

/**
 * Plain-language explanations of why specific tools are needed, so non-technical
 * users can make an informed choice (issue #783 AC2). Returns null for tools
 * without a bespoke explanation, in which case the generic description is used.
 */
function getToolPurpose(rawToolName: string): string | null {
  switch (rawToolId(rawToolName)) {
    case "capture_video_frame":
      return "YakShaver wants to capture a still frame from your screen recording so it can see what you're pointing at and keep working on your task accurately. It only runs when you say it's OK.";
    default:
      return null;
  }
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
  const toolLabel = readableToolInfo?.tool ?? "an action";
  const dialogTitle = readableToolInfo
    ? `Can YakShaver use "${readableToolInfo.tool}"?`
    : "Can YakShaver perform this action?";

  // Some tools have a clear, user-facing purpose that non-technical users benefit
  // from understanding (issue #783 AC2). Keyed on the raw, unformatted tool id so it
  // survives both MCP separators ("__" and ".") and any display-label changes.
  const toolPurpose = toolName ? getToolPurpose(toolName) : null;
  const dialogDescription =
    toolPurpose ??
    (readableToolInfo?.server
      ? `To keep working on your task, YakShaver needs to use the "${readableToolInfo.tool}" tool (from ${readableToolInfo.server}). It only runs when you say it's OK.`
      : `To keep working on your task, YakShaver needs to perform an action. It only runs when you say it's OK.`);

  return (
    <AlertDialog open={isOpen}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <div className="flex items-center gap-3">
            <div className="flex-shrink-0 w-5 h-5">
              {getServiceIcon(readableToolInfo?.server ?? null)}
            </div>
            <AlertDialogTitle>{dialogTitle}</AlertDialogTitle>
          </div>
          <AlertDialogDescription>{dialogDescription}</AlertDialogDescription>
        </AlertDialogHeader>
        {!showCorrectionForm && (
          <ul className="space-y-1.5 text-sm text-white/70">
            <li>
              <span className="font-medium text-white/90">Allow</span> &mdash; let YakShaver use{" "}
              {`"${toolLabel}"`} this one time.
            </li>
            <li>
              <span className="font-medium text-white/90">Allow Always</span> &mdash; let YakShaver
              use {`"${toolLabel}"`} now and skip this prompt next time.
            </li>
            <li>
              <span className="font-medium text-white/90">Review / Correct&hellip;</span> &mdash;
              don't run {`"${toolLabel}"`} as-is. You can leave a note telling YakShaver what to
              change and try again, or stop the step entirely.
            </li>
          </ul>
        )}
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
                Review / Correct&hellip;
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
