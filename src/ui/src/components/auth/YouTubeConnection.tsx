import { IS_GLOBAL } from "@shared/config/region";
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
  // YouTube is unavailable in builds without YouTube infrastructure (e.g. china).
  // Render nothing so the parent layout collapses naturally.
  if (!IS_GLOBAL) {
    return null;
  }

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

  const handleYouTubeAction = async () => {
    if (isConnected) {
      await disconnect();
      onStatusChange?.(false);
    } else {
      startCountdown();
      try {
        await startAuth();
      } finally {
        resetCountdown();
      }
    }
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
      onAction={handleYouTubeAction}
      actionLabel={getYouTubeButtonText()}
      actionDisabled={isConnecting && !isConnected}
      buttonVariant={isConnected ? "destructiveOutline" : "outline"}
      buttonSize={buttonSize}
    />
  );
}
