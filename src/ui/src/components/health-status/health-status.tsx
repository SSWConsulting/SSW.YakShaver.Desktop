import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import * as React from "react";
import { cn } from "@/lib/utils";

interface HealthStatusProps extends React.HTMLAttributes<HTMLDivElement> {
  isChecking: boolean;
  isHealthy: boolean;
  successMessage?: string;
  error?: string;
}

export const HealthStatus = React.forwardRef<HTMLDivElement, HealthStatusProps>(
  (
    { className, isChecking, isHealthy, successMessage, error, ...props },
    ref
  ) => {
    if (isChecking) {
      return (
        <div
          ref={ref}
          className={cn("group relative flex items-center gap-2", className)}
          {...props}
        >
          <Loader2 className="h-5 w-5 text-white/50 animate-spin" />
          <span className="invisible group-hover:visible absolute left-0 top-6 z-10 w-max max-w-xs rounded bg-neutral-800 px-2 py-1 text-xs text-white shadow-lg">
            Checking...
          </span>
        </div>
      );
    }

    if (isHealthy) {
      return (
        <div
          ref={ref}
          className={cn("group relative flex items-center gap-2", className)}
          {...props}
        >
          <CheckCircle2 className="h-5 w-5 text-green-400" />
          <span className="invisible group-hover:visible absolute left-0 top-6 z-10 w-max max-w-xs rounded bg-neutral-800 px-2 py-1 text-xs text-white shadow-lg break-words whitespace-normal">
            {successMessage}
          </span>
        </div>
      );
    }

    return (
      <div
        ref={ref}
        className={cn("group relative flex items-center gap-2", className)}
        {...props}
      >
        <XCircle className="h-5 w-5 text-red-400" />
        <span className="invisible group-hover:visible absolute left-0 top-6 z-10 w-max max-w-48 rounded bg-neutral-800 px-2 py-1 text-xs text-white shadow-lg break-words whitespace-normal">
          {error ? `Unhealthy - ${error}` : "Unhealthy"}
        </span>
      </div>
    );
  }
);

HealthStatus.displayName = "HealthStatus";
