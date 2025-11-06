import { useState } from "react";
import { useYouTubeAuth } from "../../contexts/YouTubeAuthContext";
import { AuthStatus, UploadStatus } from "../../types";
import { ConnectedStatus } from "../auth/ConnectedStatus";
import { NotConnectionStatus } from "../auth/NotConnectedStatus";
import { PlatformSelector } from "../auth/PlatformSelector";
import { UploadResult } from "../video/UploadResult";

export const VideoHostPanel = () => {
  const { authState, hasConfig, uploadResult, uploadStatus } = useYouTubeAuth();
  const [showSelector, setShowSelector] = useState(false);

  const { status, userInfo } = authState;
  const isConnected = status === AuthStatus.AUTHENTICATED && userInfo;

  return (
    <div className="w-[500px] mx-auto py-8 min-h-[400px]">
      <div className="w-full flex flex-col items-center gap-6">
        {showSelector ? (
          <PlatformSelector onClose={() => setShowSelector(false)} hasYouTubeConfig={hasConfig} />
        ) : isConnected ? (
          <ConnectedStatus
            userInfo={userInfo}
            platform="YouTube"
            onSwitch={() => setShowSelector(true)}
          />
        ) : (
          <NotConnectionStatus onConnect={() => setShowSelector(true)} />
        )}

        {(uploadStatus !== UploadStatus.IDLE || uploadResult) && (
          <UploadResult result={uploadResult} status={uploadStatus} />
        )}
      </div>
    </div>
  );
};
