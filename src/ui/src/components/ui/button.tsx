import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

// WCAG 2.5.5 minimum touch target = 44px (issue #898).
// For compact variants (sm/icon) we keep the visual box small but expand the
// *hit* area to 44px via a transparent ::before overlay, so dense rows
// (toolbars, the recording bar, list rows) don't visually grow.
//
// Exported so other primitives (e.g. checkbox.tsx) reuse the same overlay
// instead of inlining a copy (AGENTS.md "Constants Over Literals").
//
// NOTE: a full 44px-tall overlay safely covers both axes for an *isolated*
// control, but it overflows its row when controls are stacked vertically
// closer than 44px apart, so adjacent overlays overlap and a click can hit
// the wrong control. Use this only where vertical neighbours are >=44px away
// (icon/sm buttons sit in horizontal toolbars). Vertically-stacked controls
// such as checkboxes must instead clamp the overlay to the row height — see
// HIT_TARGET_44_X in checkbox.tsx.
export const HIT_TARGET_44 =
  "relative before:absolute before:left-1/2 before:top-1/2 before:size-11 before:min-h-11 before:min-w-11 before:-translate-x-1/2 before:-translate-y-1/2 before:content-['']";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-all disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        destructive:
          "bg-destructive text-white hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 dark:bg-destructive/60",
        // Outlined danger variant — reserved for irreversible / destructive
        // actions. Quieter than a solid-red primary; deepens on interaction.
        // Uses the SSW hot-red token (--danger / #ff453a). The button itself
        // never confirms — it only signals danger and triggers a confirm step.
        destructiveOutline:
          "min-h-11 border border-danger/60 text-white bg-danger/8 shadow-xs transition-colors duration-150 hover:bg-danger/15 focus-visible:ring-danger/40 focus-visible:border-danger",
        outline:
          "border bg-background shadow-xs hover:bg-accent hover:text-accent-foreground dark:bg-input/30 dark:border-input dark:hover:bg-input/50",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost: "hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        // 44px minimum touch target on both axes by default
        // (WCAG 2.5.5 C44 requires min-block-size AND min-inline-size).
        default: "min-h-11 min-w-11 px-4 py-2 has-[>svg]:px-3",
        // Compact variants keep their visual size but get a 44px hit area.
        sm: `h-8 rounded-md gap-1.5 px-3 has-[>svg]:px-2.5 ${HIT_TARGET_44}`,
        lg: "min-h-11 min-w-11 rounded-md px-6 has-[>svg]:px-4",
        icon: `size-9 ${HIT_TARGET_44}`,
        chunky: "h-14 px-6 py-4"
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot : "button";

  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
