import { AlertTriangle } from "lucide-react";
import type { SettingsTabHealth } from "./settings-health";

interface SettingsNavHealthIndicatorProps {
  health: SettingsTabHealth;
}

/**
 * #878 — the single shared indicator shown on a Settings side-nav tab that has a
 * critical configuration problem. A warning triangle (carrying the issue as its
 * accessible name) plus a hover/focus tooltip explaining the specific issue.
 * Using one component everywhere keeps the treatment consistent across every
 * page (AC4/AC13/AC14).
 *
 * #872 (AC1) — uses the shared `--warning` token rather than a hand-mixed amber
 * shade, so this reads consistently with every other "needs attention" surface
 * in Settings (`SettingsWarningBanner` etc.), and keeps `danger` reserved
 * exclusively for destructive actions (AC7/AC8) — this indicator flags a
 * configuration problem, not something the user is about to destroy.
 *
 * The parent nav button must be `group relative` for the hover tooltip to anchor.
 */
export function SettingsNavHealthIndicator({ health }: SettingsNavHealthIndicatorProps) {
  return (
    // No `relative` here: the tooltip anchors to the nav button (the `group
    // relative` ancestor) instead of this tiny icon span, so it can span the
    // full nav-item width rather than overflowing the w-48 container from the
    // icon's right edge (which clipped the text + spawned a scrollbar) (#982).
    <span className="inline-flex shrink-0 items-center">
      <AlertTriangle
        className="h-4 w-4 text-warning"
        role="img"
        aria-label={`Configuration issue: ${health.message}`}
      />
      {/* Anchored to the nav button: left-2/right-2 pins it inside the item's
          horizontal padding and top-full drops it just below, so it always
          stays within the nav column. Solid bg fully covers the item beneath;
          z-50 + shadow keep it floating on top. */}
      <span
        role="tooltip"
        className="pointer-events-none invisible absolute inset-x-2 top-full z-50 mt-1 whitespace-normal rounded-md border border-warning/40 bg-neutral-800 px-2.5 py-1.5 text-left text-xs font-normal text-warning shadow-lg group-hover:visible group-focus-within:visible"
      >
        {health.message}
      </span>
    </span>
  );
}
