import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface SettingsSectionProps {
  /** Section heading. A ReactNode so callers compose their own leading icon
   * (icon sizes already vary per panel), e.g. `<><Keyboard className="h-4 w-4" /> Key Mapping</>`. */
  title: ReactNode;
  /** Optional one-line description under the title. */
  description?: ReactNode;
  /** Extra classes for the content area — panels vary (grid, flex row, etc.). */
  contentClassName?: string;
  /** Extra classes for the section wrapper. */
  className?: string;
  /** Optional so a transient loading/empty state can render just the header. */
  children?: ReactNode;
}

/**
 * #880 (AC16) — the shared "settings section" surface. Every settings panel was
 * repeating the same `Card` + `CardHeader(title/description)` + `CardContent`
 * shell (e.g. Key Mapping, Tool Approval, model settings). Extracting it removes
 * that duplication and gives one place to evolve the treatment.
 *
 * #872 (AC2) — no `Card` here anymore: a raised, bordered, shadowed panel isn't
 * warranted for content that carries no elevation meaning (it's not a modal, a
 * popover, or "floating" over anything). A bottom border reads as a section
 * divider instead, which is lighter-weight while still separating sections
 * visually — the same treatment `KeyMappingSetting`/`StartupSetting` etc. get
 * automatically since they already compose through this component.
 */
export function SettingsSection({
  title,
  description,
  contentClassName,
  className,
  children,
}: SettingsSectionProps) {
  return (
    <section
      className={cn("w-full border-b border-white/10 pb-5 last:border-b-0 last:pb-0", className)}
    >
      <div className="flex flex-col gap-1">
        <h3 className="flex items-center gap-2 text-sm leading-none font-semibold">{title}</h3>
        {description ? <p className="text-muted-foreground text-sm">{description}</p> : null}
      </div>
      {children ? <div className={cn("mt-4", contentClassName)}>{children}</div> : null}
    </section>
  );
}
