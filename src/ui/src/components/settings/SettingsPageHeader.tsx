import type { LucideIcon } from "lucide-react";

interface SettingsPageHeaderProps {
  /** Optional leading icon for the page. */
  icon?: LucideIcon;
  title: string;
  description?: string;
}

/**
 * Consistent header for every Settings panel (#879): an optional leading icon,
 * the page title, and a description — aligned the same way on every page.
 *
 * The Settings dialog no longer renders a global "Settings" title (it was
 * redundant with these per-page titles), so this is the visible page heading.
 */
export function SettingsPageHeader({ icon: Icon, title, description }: SettingsPageHeaderProps) {
  return (
    <div className="space-y-1">
      <h2 className="flex items-center gap-2 text-xl font-semibold">
        {Icon ? <Icon className="h-5 w-5 shrink-0" aria-hidden="true" /> : null}
        {title}
      </h2>
      {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
    </div>
  );
}
