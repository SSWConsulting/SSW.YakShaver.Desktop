import { AlertTriangle, ShieldAlert } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import type {
  McpToolPermissionRequest,
  McpToolPermissionResolution,
} from "@/types";
import { ipcClient } from "../../services/ipc-client";
import { Button } from "../ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Textarea } from "../ui/textarea";

const MODE_COPY: Record<
  McpToolPermissionRequest["mode"],
  { title: string; description: string }
> = {
  warn: {
    title: "Heads up",
    description: "YakShaver will continue automatically if you don't respond in time.",
  },
  ask_first: {
    title: "Approval required",
    description: "YakShaver is waiting for your decision before running this tool.",
  },
};

export function ToolPermissionPromptHost() {
  const [queue, setQueue] = useState<McpToolPermissionRequest[]>([]);
  const [feedback, setFeedback] = useState("");
  const [countdown, setCountdown] = useState<number | null>(null);

  const activeRequest = queue[0];

  useEffect(() => {
    const unsubscribeRequest = ipcClient.mcp.onToolPermissionRequest((request) => {
      setQueue((prev) => [...prev, request]);
    });

    const unsubscribeResolved = ipcClient.mcp.onToolPermissionResolved(
      (resolution: McpToolPermissionResolution) => {
        setQueue((prev) => {
          const wasActive = prev[0]?.requestId === resolution.requestId;
          const next = prev.filter((item) => item.requestId !== resolution.requestId);
          if (wasActive) {
            setFeedback("");
            setCountdown(null);
          }
          return next;
        });
      },
    );

    return () => {
      unsubscribeRequest();
      unsubscribeResolved();
    };
  }, []);

  useEffect(() => {
    setFeedback("");
  }, [activeRequest?.requestId]);

  useEffect(() => {
    if (!activeRequest || activeRequest.mode !== "warn" || !activeRequest.timeoutMs) {
      setCountdown(null);
      return;
    }

    const expiresAt = activeRequest.requestedAt + activeRequest.timeoutMs;
    const updateCountdown = () => {
      const remainingMs = expiresAt - Date.now();
      setCountdown(Math.max(0, Math.ceil(remainingMs / 1000)));
    };
    updateCountdown();
    const interval = setInterval(updateCountdown, 250);
    return () => clearInterval(interval);
  }, [activeRequest]);

  const argsPreview = useMemo(() => {
    if (!activeRequest) return "{}";
    try {
      return JSON.stringify(activeRequest.args ?? {}, null, 2);
    } catch {
      return String(activeRequest.args);
    }
  }, [activeRequest]);

  const respond = useCallback(
    (decision: McpToolPermissionResolution["decision"], responseFeedback?: string) => {
      if (!activeRequest) return;
      ipcClient.mcp.respondToToolPermission({
        requestId: activeRequest.requestId,
        decision,
        feedback: responseFeedback,
      });
      setQueue((prev) => prev.filter((item) => item.requestId !== activeRequest.requestId));
      setFeedback("");
      setCountdown(null);
    },
    [activeRequest],
  );

  const handleAlwaysAccept = useCallback(() => {
    respond("always_accept");
  }, [respond]);

  const handleAcceptOnce = useCallback(() => {
    respond("accept_once");
  }, [respond]);

  const handleReject = useCallback(() => {
    if (!feedback.trim()) {
      toast.error("Please provide feedback before rejecting the tool call.");
      return;
    }
    respond("reject", feedback.trim());
  }, [feedback, respond]);

  if (!activeRequest) {
    return null;
  }

  const modeCopy = MODE_COPY[activeRequest.mode];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <Card className="w-full max-w-2xl border-white/20 bg-neutral-900 text-white shadow-2xl">
        <CardHeader className="space-y-2">
          <div className="flex items-center gap-3">
            {activeRequest.mode === "warn" ? (
              <AlertTriangle className="h-6 w-6 text-amber-400" />
            ) : (
              <ShieldAlert className="h-6 w-6 text-sky-400" />
            )}
            <div>
              <CardTitle className="text-xl">YakShaver wants to run a tool</CardTitle>
              <p className="text-sm text-white/70">{modeCopy.description}</p>
            </div>
          </div>
          {activeRequest.mode === "warn" && countdown !== null && (
            <p className="text-sm text-amber-300">
              Auto-accepting in <span className="font-semibold">{countdown}s</span> unless you
              respond.
            </p>
          )}
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="rounded-lg border border-white/10 bg-white/5 p-4">
            <p className="text-sm text-white/70 uppercase tracking-wide">Tool</p>
            <p className="text-lg font-semibold text-white">{activeRequest.toolName}</p>
            <p className="text-sm text-white/60 mt-1">Server: {activeRequest.serverName}</p>
          </div>

          <div>
            <p className="text-sm font-semibold text-white mb-2">Arguments preview</p>
            <pre className="max-h-48 overflow-auto rounded-md bg-black/50 p-3 text-xs text-white/80 border border-white/10">
              {argsPreview}
            </pre>
          </div>

          <div className="space-y-2">
            <p className="text-sm font-semibold text-white">Feedback for YakShaver</p>
            <Textarea
              value={feedback}
              onChange={(event) => setFeedback(event.target.value)}
              placeholder="Explain why this tool should not run or what YakShaver should do instead..."
              className="bg-black/30 text-white border-white/20 placeholder:text-white/40"
              rows={4}
            />
            <p className="text-xs text-white/60">
              Feedback is optional unless you reject the tool. YakShaver sends this back to the AI so
              it can adjust.
            </p>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <Button
              variant="outline"
              className="w-full sm:w-auto border-white/30 text-white"
              onClick={handleAcceptOnce}
            >
              Accept this time
            </Button>
            <Button
              variant="secondary"
              className="w-full sm:w-auto bg-green-600 text-white hover:bg-green-500"
              onClick={handleAlwaysAccept}
            >
              Always accept
            </Button>
            <Button
              variant="destructive"
              className="w-full sm:w-auto"
              onClick={handleReject}
              disabled={!feedback.trim()}
            >
              Reject
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

