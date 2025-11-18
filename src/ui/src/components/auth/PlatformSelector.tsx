import { X } from "lucide-react";
import { useEffect } from "react";
import { FaYoutube } from "react-icons/fa";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useYouTubeAuth } from "../../contexts/YouTubeAuthContext";
import { useCountdown } from "../../hooks/useCountdown";
import { AuthStatus } from "../../types";

interface PlatformSelectorProps {
  onClose: () => void;
  hasYouTubeConfig: boolean;
}

export const PlatformSelector = ({ onClose, hasYouTubeConfig }: PlatformSelectorProps) => {
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

  // Reset countdown when user successfully connects
  useEffect(() => {
    if (isConnected) {
      resetCountdown();
    }
  }, [isConnected, resetCountdown]);

  const handleAction = async () => {
    if (isConnected) {
      await disconnect();
      onClose();
    } else {
      startCountdown();
      try {
        await startAuth();
      } finally {
        resetCountdown();
      }
    }
  };

  const getButtonText = () => {
    if (isConnected) return "Disconnect";
    if (isConnecting) return `Connecting... (${countdown}s)`;
    return "Connect";
  };

  const buttonText = getButtonText();
  const buttonStyle = isConnected
    ? "bg-white/10 text-white border border-white/20 hover:bg-white/20"
    : "bg-white text-black hover:bg-gray-200";

  return (
    <Card className="w-full bg-black/20 backdrop-blur-sm border-white/10">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-white text-2xl font-medium">Select Platform</CardTitle>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="size-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {hasYouTubeConfig ? (
          <div className="flex items-center justify-between gap-6 p-4 bg-white/5 border border-white/10 rounded-lg hover:bg-white/10 transition-colors">
            <div className="flex items-center gap-2">
              <FaYoutube className="w-8 h-8 text-ssw-red text-2xl" />
              <div>
                <h3 className="mb-1 text-base font-medium">YouTube</h3>
                {isConnected && userInfo && (
                  <p className="text-xs text-muted-foreground font-medium">{userInfo.name}</p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-4">
              {isConnected && <Badge variant="outline">Connected</Badge>}
              <Button
                variant={isConnected ? "outline" : "secondary"}
                size="sm"
                onClick={handleAction}
                disabled={isConnecting && !isConnected}
                className={buttonStyle}
              >
                {buttonText}
              </Button>
            </div>
          </div>
        ) : (
          <div className="text-center py-8 px-4 text-muted-foreground">
            <p className="mb-2 text-sm">No platforms available</p>
            <p className="text-xs italic">Configure YouTube API credentials to get started</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
