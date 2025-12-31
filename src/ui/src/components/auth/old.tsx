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
        "flex flex-col min-[1140px]:flex-row min-[1140px]:items-center min-[1140px]:justify-between min-[1140px]:flex-wrap min-[1140px]:gap-y-2 gap-3 min-[1140px]:gap-4 xl:gap-6 px-6 min-[1140px]:px-8 xl:px-10 py-4 min-[1140px]:py-5 xl:py-6 bg-white/[0.04] border border-white/[0.24] rounded-lg w-full min-w-0",
        className,
      )}
    >
      <div className="flex items-start gap-4 min-[1140px]:gap-6 flex-1 min-w-0">
        <div className="flex items-center justify-center">{icon}</div>
        <div className="flex flex-col flex-1 min-w-0">
          {label && (
            <span className="text-xs uppercase font-medium leading-4 text-white/60">{label}</span>
          )}
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm min-[1140px]:text-lg xl:text-xl font-medium leading-6 min-[1140px]:leading-7 text-white">
              {title}
            </p>
            {badgeText && (
              <Badge className="min-[1140px]:hidden flex items-center" variant={badgeVariant}>
                {badgeText}
              </Badge>
            )}
          </div>
          {subtitle && (
            <p className="text-xs min-[1140px]:text-sm text-white/[0.56] font-medium">{subtitle}</p>
          )}
          {description && (
            <p className="text-xs min-[1140px]:text-sm text-white/[0.56] italic">{description}</p>
          )}
        </div>
      </div>

      <div className="hidden min-[1140px]:flex items-center gap-3 min-[1140px]:gap-4 xl:gap-6 min-[1140px]:flex-shrink-0 min-[1140px]:self-start">
        {badgeText && (
          <Badge className="hidden min-[1140px]:inline-flex" variant={badgeVariant}>
            {badgeText}
          </Badge>
        )}
        <Button
          size={buttonSize}
          variant={buttonVariant}
          onClick={onAction}
          disabled={actionDisabled}
          className="min-[1140px]:h-10 min-[1140px]:px-5 xl:h-11 xl:px-6"
        >
          {actionLabel}
        </Button>
      </div>

      <div className="mt-2 min-[1140px]:hidden">
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
