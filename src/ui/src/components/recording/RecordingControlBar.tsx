import { Circle, Square } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import logoImageRed from "/logos/SQ-YakShaver-LogoIcon-Red.svg?url";

export default function RecordingControlBar() {
  const [time, setTime] = useState("00:00");

  useEffect(() => {
    const unsubscribe = window.electronAPI.controlBar.onTimeUpdate(setTime);
    return unsubscribe;
  }, []);

  return (
    <div className="flex h-screen w-screen items-center justify-center">
      <div className="group flex items-center rounded-xl border border-white/20 bg-black/85 px-3 py-2.5 shadow-2xl backdrop-blur-xl transition-all hover:border-white/30">
        <img
          src={logoImageRed}
          alt="YakShaver"
          className="size-7 cursor-move"
          style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
        />
        <div
          className="flex flex-1 cursor-move items-center justify-center gap-2 px-4"
          style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
        >
          <Circle className="size-2 animate-pulse fill-ssw-red text-ssw-red" />
          <span className="font-mono text-sm font-medium tabular-nums text-white">{time}</span>
        </div>
        <Separator orientation="vertical" className="h-6 bg-white/20" />
        {/*
          size="icon" ships a centered 44px ::before overlay (HIT_TARGET_44).
          On this 28px button in the frameless control bar that overlay spills
          ~8px LEFT over the Separator and into the adjacent drag region, so a
          click in that strip would fire Stop instead of dragging the bar. We
          disable the centered overlay (before:hidden) and instead give the
          button its own explicit, self-contained hit area: ml-1 clears the
          separator, and px-2.5 + py-2 grows the click box rightward into the
          pill's own padding (it does not overflow the drag region).
        */}
        <Button
          variant="ghost"
          size="icon"
          className="ml-1 size-auto px-2.5 py-2 rounded-md transition-all before:hidden hover:scale-105 hover:bg-white/10"
          onClick={() => window.electronAPI.screenRecording.stopFromControlBar()}
        >
          <Square className="size-4 fill-ssw-red text-ssw-red" />
        </Button>
      </div>
    </div>
  );
}
