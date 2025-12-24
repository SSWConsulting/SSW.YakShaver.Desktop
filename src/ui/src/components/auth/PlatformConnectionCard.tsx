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
        "flex flex-col md:flex-row md:items-center md:justify-between gap-3 md:gap-4 lg:gap-5 xl:gap-6 px-6 md:px-6 lg:px-8 xl:px-10 py-4 md:py-4 lg:py-5 xl:py-6 bg-white/[0.04] border border-white/[0.24] rounded-lg w-full",
        className,
      )}
    >
      <div className="flex items-start gap-4 md:gap-5 lg:gap-6">
        <div className="flex items-center justify-center">{icon}</div>
        <div className="flex flex-col">
          {label && (
            <span className="text-xs uppercase font-medium leading-4 text-white/60">{label}</span>
          )}
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm md:text-base lg:text-lg xl:text-xl font-medium leading-6 md:leading-6 lg:leading-7 text-white">
              {title}
            </p>
            {badgeText && (
              <Badge className="md:hidden flex items-center" variant={badgeVariant}>
                {badgeText}
              </Badge>
            )}
          </div>
          {subtitle && (
            <p className="text-xs md:text-sm text-white/[0.56] font-medium">{subtitle}</p>
          )}
          {description && (
            <p className="text-xs md:text-sm text-white/[0.56] italic">{description}</p>
          )}
        </div>
      </div>

      <div className="hidden md:flex items-center gap-3 lg:gap-4 xl:gap-6">
        {badgeText && (
          <Badge className="hidden md:inline-flex" variant={badgeVariant}>
            {badgeText}
          </Badge>
        )}
        <Button
          size={buttonSize}
          variant={buttonVariant}
          onClick={onAction}
          disabled={actionDisabled}
          className="md:h-9 md:px-4 lg:h-10 lg:px-5 xl:h-11 xl:px-6"
        >
          {actionLabel}
        </Button>
      </div>

      <div className="mt-2 md:hidden">
        <Button
          size={buttonSize}
          variant={buttonVariant}
          onClick={onAction}
          disabled={actionDisabled}
          className="w-full"
        >
          {actionLabel}
        </Button>
      </div>
    </div>
  );
};
