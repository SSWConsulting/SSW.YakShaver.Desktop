import { Mic } from "lucide-react";
import { cn } from "@/lib/utils";

interface MicrophoneLevelMeterProps {
  /** Audio level in the range [0, 1]. */
  level: number;
  className?: string;
}

/**
 * Displays a live microphone input-level bar under the camera preview.
 * The bar fills from left to right proportional to the current audio level.
 */
export function MicrophoneLevelMeter({ level, className }: MicrophoneLevelMeterProps) {
  const clampedLevel = Math.max(0, Math.min(1, level));

  // Choose colour: green at low levels, amber in the middle, red when hot
  const barColor =
    clampedLevel > 0.85 ? "bg-destructive" : clampedLevel > 0.6 ? "bg-amber-400" : "bg-emerald-500";

  return (
    <div className={cn("flex items-center gap-2 px-1", className)}>
      <Mic className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      <meter
        className="relative flex-1 h-2 rounded-full bg-white/10 overflow-hidden"
        aria-label="Microphone input level"
        aria-valuenow={Math.round(clampedLevel * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className={cn(
            "absolute inset-y-0 left-0 rounded-full transition-all duration-75",
            barColor,
          )}
          style={{ width: `${clampedLevel * 100}%` }}
        />
      </meter>
    </div>
  );
}
