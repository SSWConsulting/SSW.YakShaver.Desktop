import { useEffect } from "react";
import { YouTubeConnection } from "@/components/auth/YouTubeConnection";
import { LocalStorageHostCard } from "@/components/settings/video-host/LocalStorageHostCard";
import type { StepHandlers } from "@/types/onboarding";

interface VideoHostingStepProps {
  onRegisterHandlers: (handlers: StepHandlers) => void;
}

// #1062: connecting a video platform is optional — recordings are saved locally by default.
const ALWAYS_READY: StepHandlers = { isReady: true, validate: () => true };

export function VideoHostingStep({ onRegisterHandlers }: VideoHostingStepProps) {
  useEffect(() => {
    onRegisterHandlers(ALWAYS_READY);
  }, [onRegisterHandlers]);

  return (
    <div className="grid gap-4">
      <LocalStorageHostCard buttonSize="lg" />
      <YouTubeConnection buttonSize="lg" />
    </div>
  );
}
