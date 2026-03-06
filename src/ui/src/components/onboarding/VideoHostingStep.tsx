import { useEffect } from "react";
import { YouTubeConnection } from "@/components/auth/YouTubeConnection";
import { useYouTubeAuth } from "../../contexts/YouTubeAuthContext";
import { AuthStatus } from "../../types";

interface VideoHostingStepProps {
  onValidationChange: (isValid: boolean) => void;
}

export function VideoHostingStep({ onValidationChange }: VideoHostingStepProps) {
  const { authState } = useYouTubeAuth();
  const isConnected = authState.status === AuthStatus.AUTHENTICATED;

  useEffect(() => {
    onValidationChange(isConnected);
  }, [isConnected, onValidationChange]);

  return <YouTubeConnection buttonSize="lg" />;
}
