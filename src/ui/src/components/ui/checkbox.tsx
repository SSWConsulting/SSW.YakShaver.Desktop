import * as React from "react"
import * as CheckboxPrimitive from "@radix-ui/react-checkbox"
import { CheckIcon } from "lucide-react"

import { cn } from "@/lib/utils"

// Radix Checkbox renders as a <button> with a 16px visual box. We expand the
// click target toward WCAG 2.5.5 (44px) via a transparent ::before overlay
// without stretching the visible box.
//
// IMPORTANT — vertical clamp: checkboxes are routinely stacked vertically in
// dense lists (the MCP-server picker, the tool whitelist, the telemetry
// consent rows) closer than 44px apart. A fixed 44px-tall overlay (like the
// button HIT_TARGET_44) would overflow its row and overlap the neighbour's
// overlay, so a click near a row edge could toggle the WRONG checkbox.
// To stay safe we expand to 44px on the HORIZONTAL axis only and let the
// overlay fill exactly the row height (`before:inset-y-0`), so overlays never
// overlap. Call sites that need the full 44px vertical target give the row a
// `min-h-11` (the label spans the row via htmlFor), which the overlay then
// inherits — see PromptForm / McpWhitelistDialog.
const HIT_TARGET_44_X =
  "relative before:absolute before:inset-y-0 before:left-1/2 before:w-11 before:min-w-11 before:-translate-x-1/2 before:content-['']"

function Checkbox({
  className,
  ...props
}: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        "peer border-input dark:bg-input/30 data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground dark:data-[state=checked]:bg-primary data-[state=checked]:border-primary focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive size-4 shrink-0 rounded-[4px] border shadow-xs transition-shadow outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50",
        HIT_TARGET_44_X,
        className
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="grid place-content-center text-current transition-none"
      >
        <CheckIcon className="size-3.5" />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}

export { Checkbox }
