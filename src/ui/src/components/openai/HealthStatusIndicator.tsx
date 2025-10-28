import { CheckCircle2, XCircle, Loader2 } from "lucide-react";

interface HealthStatusIndicatorProps {
  isChecking: boolean;
  isHealthy: boolean;
  successMessage?: string;
  error?: string;
  checkingMessage?: string;
}

export function HealthStatusIndicator({
  isChecking,
  isHealthy,
  successMessage = "Healthy",
  error,
  checkingMessage = "Checking...",
}: HealthStatusIndicatorProps) {
  if (isChecking) {
    return (
      <div className="group relative flex items-center gap-2">
        <Loader2 className="h-5 w-5 text-blue-400 animate-spin" />
        <span className="invisible group-hover:visible absolute left-0 top-6 z-10 w-max max-w-xs rounded bg-neutral-800 px-2 py-1 text-xs text-white shadow-lg">
          {checkingMessage}
        </span>
      </div>
    );
  }

  if (isHealthy) {
    return (
      <div className="group relative flex items-center gap-2">
        <CheckCircle2 className="h-5 w-5 text-green-400" />
        <span className="invisible group-hover:visible absolute left-0 top-6 z-10 w-max max-w-xs rounded bg-neutral-800 px-2 py-1 text-xs text-white shadow-lg">
          {successMessage}
        </span>
      </div>
    );
  }

  return (
    <div className="group relative flex items-center gap-2">
      <XCircle className="h-5 w-5 text-red-400" />
      <span className="invisible group-hover:visible absolute left-0 top-6 z-10 max-w-48 rounded bg-neutral-800 px-2 py-1 text-xs text-white shadow-lg break-words whitespace-normal">
        {error ? `Unhealthy - ${error}` : "Unhealthy"}
      </span>
    </div>
  );
}
