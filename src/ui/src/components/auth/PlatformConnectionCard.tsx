import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type BadgeVariant = ComponentPropsWithoutRef<typeof Badge>["variant"];
type ButtonVariant = ComponentPropsWithoutRef<typeof Button>["variant"];
type ButtonSize = ComponentPropsWithoutRef<typeof Button>["size"];

interface PlatformConnectionCardProps {
  icon: ReactNode;
  title: string;
  subtitle?: string;
  description?: string;
  label?: string;
  badgeText?: string;
  badgeVariant?: BadgeVariant;
  onAction: () => void;
  actionLabel: string;
  actionDisabled?: boolean;
  buttonVariant?: ButtonVariant;
  buttonSize?: ButtonSize;
  className?: string;
}

export const PlatformConnectionCard = ({
  icon,
  title,
  subtitle,
  description,
  label,
  badgeText,
  badgeVariant = "success",
  onAction,
  actionLabel,
  actionDisabled,
  buttonVariant = "default",
  buttonSize = "lg",
  className,
}: PlatformConnectionCardProps) => {
  return (
    <div
      className={cn(
        "flex items-center justify-between px-6 py-4 bg-white/[0.04] border border-white/[0.24] rounded-lg w-full",
        className,
      )}
    >
      <div className="flex items-center gap-4">
        <div className="flex items-center justify-center">{icon}</div>
        <div className="flex flex-col">
          {label && (
            <span className="text-xs uppercase font-medium leading-4 text-white/60">{label}</span>
          )}
          <p className="text-sm font-medium leading-6 text-white">{title}</p>
          {subtitle && <p className="text-xs text-white/[0.56] font-medium">{subtitle}</p>}
          {description && <p className="text-xs text-white/[0.56] italic">{description}</p>}
        </div>
      </div>

      <div className="flex items-center gap-4">
        {badgeText && <Badge variant={badgeVariant}>{badgeText}</Badge>}
        <Button
          size={buttonSize}
          variant={buttonVariant}
          onClick={onAction}
          disabled={actionDisabled}
        >
          {actionLabel}
        </Button>
      </div>
    </div>
  );
};
