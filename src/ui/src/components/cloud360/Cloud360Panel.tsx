import type { Cloud360EventPayload } from "@shared/types/cloud360";
import { useEffect, useState } from "react";
import { ipcClient } from "@/services/ipc-client";
import type { SandboxEvent } from "../../../../backend/services/yakshaver360/types";

type Phase = "running" | "done" | "failed";

export function Cloud360Panel() {
  const [status, setStatus] = useState("Starting...");
  const [logs, setLogs] = useState("");
  const [phase, setPhase] = useState<Phase>("running");
  const [result, setResult] = useState<{ summary: string; artifacts: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const cleanup = ipcClient.pipelines.onCloud360Event((payload: Cloud360EventPayload) => {
      const event: SandboxEvent = payload.event;
      switch (event.type) {
        case "status":
          setStatus(event.message);
          break;
        case "log":
          setLogs((prev) => prev + event.data);
          break;
        case "result":
          setResult({ summary: event.summary, artifacts: event.artifacts });
          setPhase("done");
          break;
        case "error":
          setError(event.message);
          setPhase("failed");
          break;
        // "named" updates the shave title elsewhere; "approval-required" unused in v1.
      }
    });
    return cleanup;
  }, []);

  return (
    <div className="w-[500px] mx-auto my-4 rounded-lg border border-white/10 bg-black/20 p-4">
      <h2 className="text-xl mb-2">YakShaver 360 Progress</h2>

      {phase === "running" && <p className="text-sm text-white/80">{status}</p>}

      {phase === "done" && result && (
        <div className="text-sm">
          <p className="mb-2">{result.summary}</p>
          <ul className="space-y-1">
            {result.artifacts.map((url) => (
              <li key={url}>
                <a href={url} target="_blank" rel="noreferrer" className="text-blue-400 underline">
                  {url}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}

      {phase === "failed" && error && (
        <div className="rounded border border-red-500/30 bg-red-500/5 p-2 text-sm text-red-400/90">
          {error}
        </div>
      )}

      {logs && (
        <details className="mt-3">
          <summary className="cursor-pointer text-xs text-white/60">Live log</summary>
          <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap text-xs text-white/70">
            {logs}
          </pre>
        </details>
      )}
    </div>
  );
}
