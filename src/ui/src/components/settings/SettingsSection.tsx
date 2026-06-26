import type { ReactNode } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface SettingsSectionProps {
  /** Section heading. A ReactNode so callers compose their own leading icon
   * (icon sizes already vary per panel), e.g. `<><Keyboard className="h-4 w-4" /> Key Mapping</>`. */
  title: ReactNode;
  /** Optional one-line description under the title. */
  description?: ReactNode;
  /** Extra classes for the content area — panels vary (grid, flex row, etc.). */
  contentClassName?: string;
  /** Extra classes for the Card wrapper. */
  className?: string;
  children: ReactNode;
}

/**
 * #880 (AC16) — the shared "settings section" surface. Every settings panel was
 * repeating the same `Card` + `CardHeader(title/description)` + `CardContent`
 * shell (e.g. Key Mapping, Tool Approval, model settings). Extracting it removes
 * that duplication and gives one place to evolve the treatment — including a
 * later cards→dividers visual pass (#880 AC2) without editing every panel.
 */
export function SettingsSection({
  title,
  description,
  contentClassName,
  className,
  children,
}: SettingsSectionProps) {
  return (
    <Card className={cn("w-full gap-4 border-white/10 py-4", className)}>
      <CardHeader className="px-4">
        <CardTitle className="flex items-center gap-2">{title}</CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
      </CardHeader>
      <CardContent className={cn("px-4", contentClassName)}>{children}</CardContent>
    </Card>
  );
}
