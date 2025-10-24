import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useYouTubeAuth } from "../../contexts/YouTubeAuthContext";
import { AuthStatus } from "../../types";
import { ConnectedStatus } from "../auth/ConnectedStatus";
import { PlatformSelector } from "../auth/PlatformSelector";
import { UploadResult } from "../video/UploadResult";

export const VideoHostPanel = () => {
  const { authState, hasConfig, uploadResult } = useYouTubeAuth();
  const [showSelector, setShowSelector] = useState(false);

  const { status, userInfo } = authState;
  const isConnected = status === AuthStatus.AUTHENTICATED && userInfo;

  return (
    <div className="w-[500px] mx-auto py-8 min-h-[400px]">
      <div className="w-full flex flex-col items-center gap-6">
        {showSelector ? (
          <PlatformSelector onClose={() => setShowSelector(false)} hasYouTubeConfig={hasConfig} />
        ) : (
          <>
            {isConnected ? (
              <ConnectedStatus
                userInfo={userInfo}
                platform="YouTube"
                onSwitch={() => setShowSelector(true)}
              />
            ) : (
              <Card className="w-full text-center bg-black/20 backdrop-blur-sm border-white/10">
                <CardContent className="py-12">
                  <div className="text-5xl mb-4 opacity-70">📹</div>
                  <h3 className="text-white mb-2 text-lg font-medium">No platform connected</h3>
                  <p className="text-white/60 mb-8 text-sm">
                    Connect a video hosting platform to get started
                  </p>
                  <Button
                    variant="secondary"
                    size="lg"
                    onClick={() => setShowSelector(true)}
                    className="bg-white text-black hover:bg-gray-200"
                  >
                    Connect Platform
                  </Button>
                </CardContent>
              </Card>
            )}

            {uploadResult && <UploadResult result={uploadResult} />}
          </>
        )}
      </div>
    </div>
  );
};
