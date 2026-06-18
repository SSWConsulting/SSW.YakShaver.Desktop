import { AlertTriangle, ExternalLink } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { getStatusVariant } from "@/lib/shave-utils";
import { ipcClient } from "../../services/ipc-client";
import { type Shave, ShaveStatus } from "../../types";
import { LoadingState } from "../common/LoadingState";
import { Badge } from "../ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { WorkflowProgressPanel } from "./WorkflowProgressPanel";
import { reconstructWorkflowState } from "./workflow-state-reconstruct";

interface ShaveOutcomeViewProps {
  shaveId: string;
}

interface ParsedFinalOutput {
  Title?: string;
  URL?: string;
  Description?: string;
  Repository?: string;
  Labels?: string[];
}

function parseFinalOutput(finalOutput: string | null | undefined): ParsedFinalOutput | null {
  if (!finalOutput) return null;
  try {
    const clean = finalOutput.replace(/```json\n?|\n?```/g, "").trim();
    return JSON.parse(clean) as ParsedFinalOutput;
  } catch {
    return null;
  }
}

/**
 * #821: read-only view of a PAST shave's Workflow Progress, reached via `/workflow/:shaveId`.
 * The live per-stage progress isn't persisted, so this renders from the persisted shave row: the
 * status, the final result (work item link / video), and — when it failed — the error details.
 */
export function ShaveOutcomeView({ shaveId }: ShaveOutcomeViewProps) {
  const [shave, setShave] = useState<Shave | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await ipcClient.shave.getById(shaveId);
      if (!result.success || !result.data) {
        setError(result.error || "Shave not found");
        return;
      }
      setShave(result.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load shave");
    } finally {
      setLoading(false);
    }
  }, [shaveId]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return <LoadingState />;
  }

  if (error || !shave) {
    return (
      <Card className="w-[500px] mx-auto my-4 bg-black/20 backdrop-blur-md border-white/10">
        <CardContent className="py-6 text-center text-muted-foreground">
          {error || "Shave not found"}
        </CardContent>
      </Card>
    );
  }

  const parsed = parseFinalOutput(shave.finalOutput);
  const workItemUrl = parsed?.URL || shave.workItemUrl || undefined;
  const reconstructed = reconstructWorkflowState(shave.shaveStatus);
  const isFailed = shave.shaveStatus === ShaveStatus.Failed;

  return (
    <div className="w-[500px] mx-auto my-4 space-y-4">
      <Card className="bg-black/20 backdrop-blur-md border-white/10">
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <CardTitle className="text-xl truncate" title={shave.title}>
            {shave.title || "Untitled shave"}
          </CardTitle>
          <Badge variant={getStatusVariant(shave.shaveStatus)}>{shave.shaveStatus}</Badge>
        </CardHeader>
        <CardContent className="space-y-3">
          {isFailed && (shave.errorMessage || shave.errorCode) && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3">
              <div className="flex items-center gap-2 text-red-300 font-medium mb-1">
                <AlertTriangle className="h-4 w-4" />
                This shave failed
              </div>
              {shave.errorMessage && (
                <p className="text-sm text-red-200/90 break-words">{shave.errorMessage}</p>
              )}
              {shave.errorCode && (
                <p className="text-xs text-red-200/60 mt-1">Code: {shave.errorCode}</p>
              )}
            </div>
          )}

          {workItemUrl && (
            <a
              href={workItemUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-sm text-blue-300 hover:underline"
            >
              <ExternalLink className="h-4 w-4" />
              Open work item
            </a>
          )}

          {parsed?.Description && (
            <p className="text-sm text-white/80 whitespace-pre-wrap">{parsed.Description}</p>
          )}

          {shave.videoEmbedUrl && (
            <a
              href={shave.videoEmbedUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-sm text-blue-300 hover:underline"
            >
              <ExternalLink className="h-4 w-4" />
              View recording
            </a>
          )}
        </CardContent>
      </Card>

      {/* For a completed shave we can honestly show the full stage view (every stage ran). */}
      {reconstructed && (
        <WorkflowProgressPanel hydratedState={reconstructed} hydratedShaveId={undefined} />
      )}
    </div>
  );
}
