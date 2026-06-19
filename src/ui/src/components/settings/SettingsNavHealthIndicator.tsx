import { AlertTriangle } from "lucide-react";
import type { SettingsTabHealth } from "./settings-health";

interface SettingsNavHealthIndicatorProps {
  health: SettingsTabHealth;
}

/**
 * #878 — the single shared indicator shown on a Settings side-nav tab that has a
 * critical configuration problem. An amber warning triangle (carrying the issue
 * as its accessible name) plus a hover/focus tooltip explaining the specific
 * issue. Using one component everywhere keeps the treatment consistent across
 * every page (AC4).
 *
 * The parent nav button must be `group relative` for the hover tooltip to anchor.
 */
export function SettingsNavHealthIndicator({ health }: SettingsNavHealthIndicatorProps) {
  return (
    <span className="relative inline-flex shrink-0 items-center">
      <AlertTriangle
        className="h-4 w-4 text-amber-400"
        role="img"
        aria-label={`Configuration issue: ${health.message}`}
      />
      <span
        role="tooltip"
        className="pointer-events-none invisible absolute right-0 top-6 z-50 w-max max-w-[220px] whitespace-normal rounded-md border border-amber-500/30 bg-neutral-900 px-2.5 py-1.5 text-left text-xs font-normal text-amber-100 shadow-lg group-hover:visible group-focus-within:visible"
      >
        {health.message}
      </span>
    </span>
  );
}
