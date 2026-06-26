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

  useEffect(() => {
    onRegisterHandlers({ isReady: isConnected, validate: () => isConnected });
  }, [isConnected, onRegisterHandlers]);

  return <YouTubeConnection buttonSize="lg" />;
}
