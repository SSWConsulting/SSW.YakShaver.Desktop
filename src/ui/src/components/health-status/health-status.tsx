import { Ban, CheckCircle2, Loader2, XCircle } from "lucide-react";
import * as React from "react";
import { cn } from "@/lib/utils";

interface SuccessDetails {
  username?: string;
  scopes?: string[];
  rateLimitRemaining?: number;
}

interface HealthStatusProps extends React.HTMLAttributes<HTMLDivElement> {
  isDisabled: boolean;
  isChecking: boolean;
  isHealthy: boolean;
  successMessage?: string;
  successDetails?: SuccessDetails;
  error?: string;
}

export const HealthStatus = React.forwardRef<HTMLDivElement, HealthStatusProps>(
  (
    {
      className,
      isDisabled,
      isChecking,
      isHealthy,
      successMessage,
      successDetails,
      error,
      ...props
    },
    ref,
  ) => {
    if (isDisabled && !isChecking) {
      return (
        <div
          ref={ref}
          className={cn("group relative flex items-center gap-2", className)}
          {...props}
        >
          <Ban className="h-5 w-5 text-gray-600" />
          <span className="invisible group-hover:visible absolute left-0 top-6 z-10 w-max max-w-xs rounded bg-neutral-800 px-2 py-1 text-xs shadow-lg">
            MCP Server disabled
          </span>
        </div>
      );
    }

    if (isChecking) {
      return (
        <div
          ref={ref}
          className={cn("group relative flex items-center gap-2", className)}
          {...props}
        >
          <Loader2 className="h-5 w-5 text-white/50 animate-spin" />
          <span className="invisible group-hover:visible absolute left-0 top-6 z-10 w-max max-w-xs rounded bg-neutral-800 px-2 py-1 text-xs shadow-lg">
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
          <div className="invisible group-hover:visible absolute left-0 top-6 z-10 w-max max-w-xs rounded bg-neutral-800 px-2 py-2 text-xs shadow-lg break-words whitespace-normal">
            {successDetails ? (
              <div className="space-y-1">
                <div className="font-semibold text-green-400">Token is valid</div>
                {successDetails.username ? (
                  <div>
                    <span className="text-white/80">User:</span> {successDetails.username}
                  </div>
                ) : null}
                {successDetails.scopes && successDetails.scopes.length > 0 ? (
                  <div>
                    <span className="text-white/80">Scopes:</span>{" "}
                    <span className="font-mono">{successDetails.scopes.join(", ")}</span>
                  </div>
                ) : null}
                {typeof successDetails.rateLimitRemaining === "number" ? (
                  <div>
                    <span className="text-white/80">Rate limit remaining:</span>{" "}
                    {successDetails.rateLimitRemaining}
                  </div>
                ) : null}
              </div>
            ) : (
              <span>{successMessage}</span>
            )}
          </div>
        </div>
      );
    }

    return (
      <div ref={ref} className={cn("group relative flex items-center gap-2", className)} {...props}>
        <XCircle
          className="h-5 w-5 text-ssw-red"
          aria-label={error ? `Unhealthy: ${error}` : "Unhealthy"}
        />
        <div className="invisible group-hover:visible absolute left-0 top-6 z-10 w-max max-w-48 rounded bg-neutral-800 px-2 py-2 text-xs shadow-lg break-words whitespace-normal">
          <div className="font-semibold text-ssw-red">Unhealthy</div>
          {error ? <div className="text-white/90">{error}</div> : null}
        </div>
        {error ? <span className="sr-only">{`Unhealthy: ${error}`}</span> : null}
      </div>
    );
  },
);

HealthStatus.displayName = "HealthStatus";
