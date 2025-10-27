import { CheckCircle2, Loader2, XCircle } from "lucide-react";

interface HealthStatusProps {
  isChecking: boolean;
  isHealthy: boolean;
  toolCount?: number;
  error?: string;
}

export function McpServerHealthStatus({
  isChecking,
  isHealthy,
  toolCount,
  error,
}: HealthStatusProps) {
  if (isChecking) {
    return (
      <>
        <Loader2 className="h-5 w-5 text-white/50 animate-spin" />
        <div className="invisible group-hover:visible absolute left-0 top-7 z-10 bg-neutral-800 text-white text-xs rounded px-2 py-1 whitespace-nowrap shadow-lg border border-neutral-700">
          Checking server health...
        </div>
      </>
    );
  }

  if (isHealthy && toolCount !== undefined) {
    return (
      <>
        <CheckCircle2 className="h-5 w-5 text-green-500" />
        <div className="invisible group-hover:visible absolute left-0 top-7 z-10 bg-neutral-800 text-white text-xs rounded px-2 py-1 whitespace-nowrap shadow-lg border border-neutral-700">
          {`Healthy - ${toolCount} tools available`}
        </div>
      </>
    );
  }

  return (
    <>
      <XCircle className="h-5 w-5 text-red-500" />
      <div className="invisible group-hover:visible absolute left-0 top-7 z-10 bg-neutral-800 text-white text-xs rounded px-3 py-2 w-max max-w-xs shadow-lg border border-neutral-700">
        {`✗ Unhealthy - ${error || "Connection failed"}`}
      </div>
    </>
  );
}
