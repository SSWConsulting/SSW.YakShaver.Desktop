import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from "react";
import { ipcClient } from "../services/ipc-client";
import { type AuthState, AuthStatus, UploadStatus, type VideoUploadResult } from "../types";

interface YouTubeAuthContextType {
  authState: AuthState;
  isLoading: boolean;
  hasConfig: boolean;
  uploadStatus: UploadStatus;
  uploadResult: VideoUploadResult | null;
  startAuth: () => Promise<void>;
  disconnect: () => Promise<void>;
  refreshToken: () => Promise<boolean>;
  checkAuthStatus: () => Promise<void>;
  uploadVideo: () => Promise<void>;
  setUploadResult: (result: VideoUploadResult | null) => void;
  setUploadStatus: (status: UploadStatus) => void;
}

const YouTubeAuthContext = createContext<YouTubeAuthContextType | undefined>(undefined);

export const YouTubeAuthProvider = ({ children }: { children: ReactNode }) => {
  const [authState, setAuthState] = useState<AuthState>({ status: AuthStatus.NOT_AUTHENTICATED });
  const [isLoading, setIsLoading] = useState(false);
  const [hasConfig, setHasConfig] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<UploadStatus>(UploadStatus.IDLE);
  const [uploadResult, setUploadResult] = useState<VideoUploadResult | null>(null);

  const setError = useCallback((error: unknown, fallback: string) => {
    setAuthState({
      status: AuthStatus.ERROR,
      error: error instanceof Error ? error.message : fallback,
    });
  }, []);

  const withLoading = useCallback(async (operation: () => Promise<void>) => {
    setIsLoading(true);
    try {
      await operation();
    } finally {
      setIsLoading(false);
    }
  }, []);

  const checkAuthStatus = useCallback(async () => {
    await withLoading(async () => {
      if (!window.electronAPI) throw new Error("electronAPI not available");

      const [status, configExists] = await Promise.all([
        ipcClient.youtube.getAuthStatus(),
        ipcClient.config.hasYouTube(),
      ]);

      setAuthState(status);
      setHasConfig(configExists);
    });
  }, [withLoading]);

  const startAuth = useCallback(async () => {
    setAuthState({ status: AuthStatus.AUTHENTICATING });

    await withLoading(async () => {
      try {
        const result = await ipcClient.youtube.startAuth();
        setAuthState(
          result.success && result.userInfo
            ? { status: AuthStatus.AUTHENTICATED, userInfo: result.userInfo }
            : { status: AuthStatus.ERROR, error: result.error || "Authentication failed" },
        );
      } catch (error) {
        setError(error, "Authentication failed");
      }
    });
  }, [withLoading, setError]);

  const disconnect = useCallback(async () => {
    await withLoading(async () => {
      try {
        const success = await ipcClient.youtube.disconnect();
        setAuthState(
          success
            ? { status: AuthStatus.NOT_AUTHENTICATED }
            : { status: AuthStatus.ERROR, error: "Failed to disconnect" },
        );
      } catch (error) {
        setError(error, "Failed to disconnect");
      }
    });
  }, [withLoading, setError]);

  const refreshToken = useCallback(async () => {
    try {
      const success = await ipcClient.youtube.refreshToken();
      if (success) await checkAuthStatus();
      return success;
    } catch {
      return false;
    }
  }, [checkAuthStatus]);

  const uploadVideo = useCallback(async () => {
    if (authState.status !== AuthStatus.AUTHENTICATED) return;

    setUploadStatus(UploadStatus.UPLOADING);
    setUploadResult(null);

    try {
      const result = await ipcClient.youtube.uploadVideo();
      setUploadResult(result);
      setUploadStatus(result.success ? UploadStatus.SUCCESS : UploadStatus.ERROR);
    } catch (error) {
      const errorResult: VideoUploadResult = {
        success: false,
        error: error instanceof Error ? error.message : "Upload failed",
      };
      setUploadResult(errorResult);
      setUploadStatus(UploadStatus.ERROR);
    }
  }, [authState.status]);

  useEffect(() => {
    checkAuthStatus();
  }, [checkAuthStatus]);

  const value = {
    authState,
    isLoading,
    hasConfig,
    uploadStatus,
    uploadResult,
    startAuth,
    disconnect,
    refreshToken,
    checkAuthStatus,
    uploadVideo,
    setUploadResult,
    setUploadStatus,
  };

  return <YouTubeAuthContext.Provider value={value}>{children}</YouTubeAuthContext.Provider>;
};

export const useYouTubeAuth = () => {
  const context = useContext(YouTubeAuthContext);
  if (!context) {
    throw new Error("useYouTubeAuth must be used within a YouTubeAuthProvider");
  }
  return context;
};
