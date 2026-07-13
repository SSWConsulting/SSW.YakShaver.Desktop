import { AlertTriangle } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface SettingsWarningBannerProps {
  children: ReactNode;
  /** Extra actions rendered under the message, e.g. a "Re-check" button. */
  action?: ReactNode;
  className?: string;
}

/**
 * #872 (AC1) — the shared "this needs attention" banner for Settings pages.
 *
 * Several panels (Orchestrator readiness, GitHub token, custom prompts) each
 * hand-rolled their own amber/yellow warning box with slightly different
 * shades and borders. This is the one place to render that state, on the
 * shared `--warning` token, so every non-destructive "fix this" message reads
 * the same way across the dialog instead of a wall of inconsistent ambers.
 *
 * #954 review follow-up — this banner is often present on initial render (e.g.
 * "no MCP servers configured"), not just triggered after a state change, so an
 * `<output>` element (implicit `role="status"`) with `aria-live="polite"` is used
 * instead of `role="alert"`: `alert`'s assertive interrupt is meant for a one-shot,
 * attention-demanding message, not a warning that can already be present at mount.
 * Mirrors the same convention `StatusDashboard` follows (see its #949 note).
 */
export function SettingsWarningBanner({ children, action, className }: SettingsWarningBannerProps) {
  return (
    <output
      aria-live="polite"
      className={cn(
        "flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs leading-relaxed text-warning",
        className,
      )}
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <div className="flex min-w-0 flex-col gap-2">
        <span className="break-words">{children}</span>
        {action ? <div>{action}</div> : null}
      </div>
    </output>
  );
}
