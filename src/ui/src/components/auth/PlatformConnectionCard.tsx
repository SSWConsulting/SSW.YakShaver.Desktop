import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type BadgeVariant = ComponentPropsWithoutRef<typeof Badge>["variant"];
type ButtonVariant = ComponentPropsWithoutRef<typeof Button>["variant"];
type ButtonSize = ComponentPropsWithoutRef<typeof Button>["size"];

type BadgeDisplayProps = {
  badgeText?: string;
  badgeVariant: BadgeVariant;
  position: "narrow" | "fullscreen" | "compact";
};

interface PlatformConnectionCardProps {
  icon: ReactNode;
  title: string;
  subtitle?: string;
  description?: string;
  label?: string;
  badgeText?: string;
  badgeVariant?: BadgeVariant;
  onAction?: () => void;
  actionLabel?: string;
  actionDisabled?: boolean;
  buttonVariant?: ButtonVariant;
  buttonSize?: ButtonSize;
  connectedLabel?: string;
  connectedIndicator?: ReactNode;
  onSecondaryAction?: () => void;
  secondaryActionLabel?: string;
  className?: string;
  compact?: boolean;
}

const Label = ({ text }: { text: string }) => (
  <span className="mb-0.5 text-xs font-medium uppercase leading-4 text-white/60">{text}</span>
);

const BadgeDisplay = ({ badgeText, badgeVariant, position }: BadgeDisplayProps) => {
  if (!badgeText) return null;

  const positionClasses = {
    narrow: "flex items-center min-[1140px]:hidden",
    fullscreen: "hidden min-[1140px]:inline-flex",
    compact: "self-center",
  };

  return (
    <Badge variant={badgeVariant} className={cn("shrink-0", positionClasses[position])}>
      {badgeText}
    </Badge>
  );
};

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
  connectedLabel,
  connectedIndicator,
  onSecondaryAction,
  secondaryActionLabel,
  className,
  compact = false,
}: PlatformConnectionCardProps) => {
  const styles = {
    wrapper: compact
      ? "gap-4 px-6 py-4"
      : "gap-3 px-6 py-4 min-[1140px]:gap-6 min-[1140px]:px-8 min-[1140px]:py-5 xl:px-10 xl:py-6 min-[1140px]:flex-row min-[1140px]:items-center min-[1140px]:justify-between",

    contentArea: compact ? "items-start" : "items-start min-[1140px]:items-center",

    title: compact
      ? "text-base leading-5"
      : "text-sm leading-6 min-[1140px]:text-lg min-[1140px]:leading-7 xl:text-xl",

    actionArea: compact ? "mt-2" : "mt-0 items-start min-[1140px]:items-end",

    button: compact ? "w-full" : "w-full min-[1140px]:w-auto min-[1140px]:px-5 xl:px-6",
  };

  return (
    <div
      className={cn(
        "flex flex-col w-full bg-white/[0.04] border border-white/[0.24] rounded-lg",
        styles.wrapper,
        className,
      )}
    >
      {compact && label && <Label text={label} />}
      <div className={cn("flex flex-1 min-w-0 gap-4", styles.contentArea)}>
        <div className="flex shrink-0 items-center justify-center pt-1">{icon}</div>
        <div className="flex flex-1 flex-col min-w-0 justify-center">
          {!compact && label && <Label text={label} />}
          <div className="flex flex-wrap items-center gap-2">
            <p className={cn("font-medium text-white", styles.title)}>{title}</p>
            {!compact && (
              <BadgeDisplay badgeText={badgeText} badgeVariant={badgeVariant} position="narrow" />
            )}
          </div>
          {subtitle && <p className="text-sm font-medium text-white/[0.56]">{subtitle}</p>}
          {description && <p className="text-sm italic text-white/[0.56]">{description}</p>}
        </div>

        {compact && (
          <BadgeDisplay badgeText={badgeText} badgeVariant={badgeVariant} position="compact" />
        )}
      </div>

      <div className={cn("flex shrink-0 flex-col gap-3", styles.actionArea)}>
        {!compact && (
          <BadgeDisplay badgeText={badgeText} badgeVariant={badgeVariant} position="fullscreen" />
        )}

        {connectedLabel ? (
          <div className="flex flex-col items-start gap-2 min-[1140px]:items-end">
            <div className="flex items-center gap-2 text-sm font-medium text-success">
              {connectedIndicator}
              <span>{connectedLabel}</span>
            </div>
            {secondaryActionLabel && onSecondaryAction && (
              <Button
                type="button"
                variant="link"
                size="sm"
                onClick={onSecondaryAction}
                className="h-auto min-h-0 min-w-0 px-0 py-0 text-sm text-muted-foreground underline underline-offset-4 before:hidden hover:text-foreground"
              >
                {secondaryActionLabel}
              </Button>
            )}
          </div>
        ) : (
          actionLabel &&
          onAction && (
            <Button
              size={buttonSize}
              variant={buttonVariant}
              onClick={onAction}
              disabled={actionDisabled}
              aria-label={actionLabel}
              className={cn(styles.button)}
            >
              {actionLabel}
            </Button>
          )
        )}
      </div>
    </div>
  );
};
