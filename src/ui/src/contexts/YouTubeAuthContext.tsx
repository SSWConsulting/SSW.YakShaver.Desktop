import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from "react";
import { parseWorkflowProgressNeoPayload, parseWorkflowStepPayload } from "@/utils";
import { STATUS_DASHBOARD_REFRESH_EVENT } from "../components/layout/status-dashboard";
import { ipcClient } from "../services/ipc-client";
import { type AuthState, AuthStatus, UploadStatus, type VideoUploadResult } from "../types";

interface YouTubeAuthContextType {
  authState: AuthState;
  isLoading: boolean;
  uploadStatus: UploadStatus;
  uploadResult: VideoUploadResult | null;
  startAuth: () => Promise<void>;
  disconnect: () => Promise<void>;
  refreshToken: () => Promise<boolean>;
  checkAuthStatus: () => Promise<void>;
  setUploadResult: (result: VideoUploadResult | null) => void;
  setUploadStatus: (status: UploadStatus) => void;
}

const YouTubeAuthContext = createContext<YouTubeAuthContextType | undefined>(undefined);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isVideoUploadResult(value: unknown): value is VideoUploadResult {
  return isRecord(value) && typeof value.success === "boolean";
}

function getUploadResult(payload: unknown): VideoUploadResult | undefined {
  return isRecord(payload) && isVideoUploadResult(payload.uploadResult)
    ? payload.uploadResult
    : undefined;
}

export const YouTubeAuthProvider = ({ children }: { children: ReactNode }) => {
  const [authState, setAuthState] = useState<AuthState>({
    status: AuthStatus.NOT_AUTHENTICATED,
  });
  // #1023 review — starts true (not false): the initial checkAuthStatus() call only
  // begins inside a useEffect below, which runs *after* the first render, so a
  // `false` default here would let consumers briefly read
  // "not loading, not authenticated" before the check has even started.
  const [isLoading, setIsLoading] = useState(true);
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

      const status = await ipcClient.youtube.getAuthStatus();
      setAuthState(status);
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
            : {
                status: AuthStatus.ERROR,
                error: result.error || "Authentication failed",
              },
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

  // #1023 review — re-check on mount, when the window regains focus, and on
  // STATUS_DASHBOARD_REFRESH_EVENT (dispatched when the Settings dialog closes,
  // per SettingsDialog.tsx), mirroring the same pattern useCloud360Mode and
  // HomeMcpStatusBanner already use. Without this, authState was only ever read
  // once at mount, so ScreenRecorder's new disabled-reason tooltip/Badge/banner
  // could keep showing "not connected" after a user connects a video host via
  // Settings, until the whole app remounts.
  useEffect(() => {
    checkAuthStatus();
    const onRefresh = () => checkAuthStatus();
    window.addEventListener("focus", onRefresh);
    window.addEventListener(STATUS_DASHBOARD_REFRESH_EVENT, onRefresh);
    return () => {
      window.removeEventListener("focus", onRefresh);
      window.removeEventListener(STATUS_DASHBOARD_REFRESH_EVENT, onRefresh);
    };
  }, [checkAuthStatus]);

  // Listen to workflow progress for upload results
  useEffect(() => {
    return ipcClient.workflow.onProgressNeo((data: unknown) => {
      const progress = parseWorkflowProgressNeoPayload(data);
      if (!progress.state) {
        return;
      }

      const uploadPayload = parseWorkflowStepPayload(progress.state.uploading_video);
      const downloadPayload = parseWorkflowStepPayload(progress.state.downloading_video);
      const nextUploadResult = getUploadResult(uploadPayload) ?? getUploadResult(downloadPayload);

      if (nextUploadResult) {
        setUploadResult(nextUploadResult);
        setUploadStatus(nextUploadResult.success ? UploadStatus.SUCCESS : UploadStatus.ERROR);
      }
    });
  }, []);

  const value = {
    authState,
    isLoading,
    uploadStatus,
    uploadResult,
    startAuth,
    disconnect,
    refreshToken,
    checkAuthStatus,
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
