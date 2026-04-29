import { IS_GLOBAL } from "@shared/config/region";
import { useEffect } from "react";
import { YouTubeConnection } from "@/components/auth/YouTubeConnection";
import type { StepHandlers } from "@/types/onboarding";
import { useYouTubeAuth } from "../../contexts/YouTubeAuthContext";
import { AuthStatus } from "../../types";

interface VideoHostingStepProps {
  onRegisterHandlers: (handlers: StepHandlers) => void;
}

export function VideoHostingStep({ onRegisterHandlers }: VideoHostingStepProps) {
  const { authState } = useYouTubeAuth();
  const isConnected = authState.status === AuthStatus.AUTHENTICATED;

  // In builds without video host infrastructure (e.g. china), auto-pass the step
  // so onboarding doesn't dead-end. Real video host wiring lands in a follow-up.
  const stepReady = IS_GLOBAL ? isConnected : true;

  useEffect(() => {
    onRegisterHandlers({ isReady: stepReady, validate: () => stepReady });
  }, [stepReady, onRegisterHandlers]);

  if (!IS_GLOBAL) {
    return (
      <p className="text-sm text-white/[0.56]">
        Video hosting is not configured for this build. You can continue and connect a host later.
      </p>
    );
  }

  return <YouTubeConnection buttonSize="lg" />;
}
