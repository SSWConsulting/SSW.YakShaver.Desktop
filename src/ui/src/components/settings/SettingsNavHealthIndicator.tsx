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
    <span className="relative inline-flex shrink-0 items-center">
      <AlertTriangle
        className="h-4 w-4 text-warning"
        role="img"
        aria-label={`Configuration issue: ${health.message}`}
      />
      {/* Below the icon, right-aligned. Uses a SOLID background (not a translucent
          warning tint) so it fully covers the next nav item's text instead of
          letting it bleed through; z-50 + shadow keep it floating on top. Staying
          inside the nav item avoids the w-48 overflow container clipping it and
          spawning a horizontal scrollbar (which left-full did) (#982). */}
      <span
        role="tooltip"
        className="pointer-events-none invisible absolute right-0 top-6 z-50 w-max max-w-[220px] whitespace-normal rounded-md border border-warning/40 bg-neutral-800 px-2.5 py-1.5 text-left text-xs font-normal text-warning shadow-lg group-hover:visible group-focus-within:visible"
      >
        {health.message}
      </span>
    </span>
  );
}
