import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { type StatusItem, type StatusLevel, useStatusDashboard } from "./status-dashboard";

const DOT_CLASSES: Record<StatusLevel, string> = {
  green: "bg-emerald-500",
  yellow: "bg-yellow-400",
  red: "bg-red-500",
};

const TEXT_CLASSES: Record<StatusLevel, string> = {
  green: "text-white/60",
  yellow: "text-yellow-200",
  red: "text-red-300",
};

interface StatusRowProps {
  label: string;
  item: StatusItem;
}

function StatusRow({ label, item }: StatusRowProps) {
  const isWarning = item.level !== "green";
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center gap-2">
        <span
          aria-hidden="true"
          className={`h-2 w-2 rounded-full shrink-0 ${DOT_CLASSES[item.level]}`}
        />
        <span className="text-xs font-medium text-white/80">
          {label}
          <span className="sr-only">: {item.level}</span>
        </span>
      </div>
      {isWarning && (
        <div className="flex items-start gap-1.5 pl-4">
          <AlertTriangle
            className={`h-3.5 w-3.5 shrink-0 mt-0.5 ${item.level === "red" ? "text-red-400" : "text-yellow-400"}`}
          />
          <span className={`text-[11px] leading-tight ${TEXT_CLASSES[item.level]}`}>
            {item.message}
          </span>
        </div>
      )}
    </div>
  );
}

/**
 * #948 — sidebar status dashboard shown between "Projects" and "Settings". Gives
 * an always-visible, at-a-glance signal for the three things that otherwise fail
 * silently until a shave breaks: login status, MCP server connection status, and
 * language model connection status. Updates automatically (mount, window focus,
 * and STATUS_DASHBOARD_REFRESH_EVENT) so it reflects changes made in Settings.
 */
export function StatusDashboard() {
  const dashboard = useStatusDashboard();
  const allHealthy =
    dashboard.login.level === "green" &&
    dashboard.mcp.level === "green" &&
    dashboard.languageModel.level === "green";

  return (
    <div className="flex flex-col gap-2 rounded-md border border-white/10 bg-white/[0.03] px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-white/50">
        {allHealthy ? (
          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
        ) : (
          <AlertTriangle className="h-3.5 w-3.5 text-yellow-400" />
        )}
        Status
      </div>
      <StatusRow label="Login" item={dashboard.login} />
      <StatusRow label="MCP servers" item={dashboard.mcp} />
      <StatusRow label="Language model" item={dashboard.languageModel} />
    </div>
  );
}
