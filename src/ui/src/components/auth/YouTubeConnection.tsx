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
  const { authState, startAuth, disconnect, hasConfig } = useYouTubeAuth();
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

  if (!hasConfig) {
    return (
      <div className="text-center py-8 px-4 text-white/[0.56]">
        <p className="mb-2 text-sm">No platforms available</p>
        <p className="text-xs italic">Configure YouTube API credentials to get started</p>
      </div>
    );
  }

  return (
    <PlatformConnectionCard
      icon={<FaYoutube className="w-10 h-10 text-ssw-red text-2xl" />}
      title="YouTube"
      subtitle={isConnected && userInfo?.channelName ? userInfo.channelName : undefined}
      badgeText={isConnected ? "Connected" : undefined}
      onAction={handleYouTubeAction}
      actionLabel={getYouTubeButtonText()}
      actionDisabled={isConnecting && !isConnected}
      buttonSize={buttonSize}
    />
  );
}
