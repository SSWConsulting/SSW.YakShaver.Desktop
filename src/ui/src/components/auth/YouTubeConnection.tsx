import { CheckCircle2 } from "lucide-react";
import { FaYoutube } from "react-icons/fa";
import { useYouTubeAuth } from "../../contexts/YouTubeAuthContext";
import { useCountdown } from "../../hooks/useCountdown";
import { AuthStatus } from "../../types";
import { PlatformConnectionCard } from "./PlatformConnectionCard";

export interface YouTubeConnectionProps {
  buttonSize?: "default" | "sm" | "lg" | "icon";
  onStatusChange?: (isConnected: boolean) => void;
}

export function YouTubeConnection({ buttonSize = "lg", onStatusChange }: YouTubeConnectionProps) {
  const { authState, startAuth, disconnect } = useYouTubeAuth();
  const {
    countdown,
    isActive: isConnecting,
    start: startCountdown,
    reset: resetCountdown,
  } = useCountdown({
    initialSeconds: 60,
  });

  const { status, userInfo } = authState;
  const isConnected = status === AuthStatus.AUTHENTICATED;
  // Surface auth failures (e.g. the #596 "no verification prompt" timeout) instead of
  // silently reverting to "Connect" with no feedback.
  const errorMessage = status === AuthStatus.ERROR ? authState.error : undefined;

  const handleConnect = async () => {
    startCountdown();
    try {
      await startAuth();
    } finally {
      resetCountdown();
    }
  };

  const handleDisconnect = async () => {
    await disconnect();
    onStatusChange?.(false);
  };

  const getYouTubeButtonText = () => {
    if (isConnected) return "Disconnect";
    if (isConnecting) return `Connecting... (${countdown}s)`;
    return "Connect";
  };

  return (
    <PlatformConnectionCard
      icon={<FaYoutube className="w-10 h-10 text-ssw-red text-2xl" />}
      title="YouTube"
      subtitle={isConnected && userInfo?.channelName ? userInfo.channelName : undefined}
      description={errorMessage}
      onAction={isConnected ? undefined : handleConnect}
      actionLabel={isConnected ? undefined : getYouTubeButtonText()}
      actionDisabled={isConnecting && !isConnected}
      buttonVariant="default"
      buttonSize={buttonSize}
      connectedLabel={isConnected ? "Connected" : undefined}
      connectedIndicator={
        isConnected ? <CheckCircle2 className="size-4" aria-hidden="true" /> : undefined
      }
      onSecondaryAction={isConnected ? handleDisconnect : undefined}
      secondaryActionLabel={isConnected ? "Disconnect" : undefined}
    />
  );
}
