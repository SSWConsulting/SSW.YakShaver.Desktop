import { type ChangeEvent, useCallback, useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";
import { formatErrorMessage } from "@/utils";
import { useAdvancedSettings } from "../../contexts/AdvancedSettingsContext";
import { useYouTubeAuth } from "../../contexts/YouTubeAuthContext";
import { useScreenRecording } from "../../hooks/useScreenRecording";
import {
  AuthStatus,
  UploadStatus,
  type ChromeMonitorState,
  type ChromeTelemetryEvent,
} from "../../types";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { SourcePickerDialog } from "./SourcePickerDialog";
import { VideoPreviewModal } from "./VideoPreviewModal";

interface RecordedVideo {
  blob: Blob;
  filePath: string;
}

export function ScreenRecorder() {
  const { authState, setUploadResult, setUploadStatus } = useYouTubeAuth();
  const { isYoutubeUrlWorkflowEnabled } = useAdvancedSettings();
  const { isRecording, isProcessing, start, stop } = useScreenRecording();
  const [isTranscribing, _] = useState(false);
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [isProcessingUrl, setIsProcessingUrl] = useState(false);
  const [chromeState, setChromeState] = useState<ChromeMonitorState | null>(null);
  const [isOpeningChrome, setIsOpeningChrome] = useState(false);
  const chromeEnabledRef = useRef(false);
  const youtubeUrlInputId = useId();

  const [pickerOpen, setPickerOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [recordedVideo, setRecordedVideo] = useState<RecordedVideo | null>(null);

  const isAuthenticated = authState.status === AuthStatus.AUTHENTICATED;

  const startChromeCapture = useCallback(async () => {
    if (!chromeState?.enabled) return;
    try {
      const result = await window.electronAPI.chromeMonitor.startCapture();
      if (!result.success && result.message) {
        toast.warning(result.message);
      }
    } catch (error) {
      toast.warning(`Chrome capture error: ${formatErrorMessage(error)}`);
    }
  }, [chromeState?.enabled]);

  const stopChromeCapture = useCallback(async () => {
    if (!chromeState?.enabled) return;
    try {
      const result = await window.electronAPI.chromeMonitor.stopCapture();
      if (!result.success && result.message) {
        toast.warning(result.message);
      }
    } catch (error) {
      toast.warning(`Chrome capture error: ${formatErrorMessage(error)}`);
    }
  }, [chromeState?.enabled]);

  const handleStopRecording = useCallback(async () => {
    await stopChromeCapture();
    const result = await stop();
    if (result) {
      setRecordedVideo(result);
      setPreviewOpen(true);
      await window.electronAPI.screenRecording.restoreMainWindow();
    }
  }, [stop, stopChromeCapture]);

  const toggleRecording = () => {
    isRecording ? handleStopRecording() : setPickerOpen(true);
  };

  useEffect(() => {
    const cleanup = window.electronAPI.screenRecording.onStopRequest(handleStopRecording);
    return cleanup;
  }, [handleStopRecording]);

  useEffect(() => {
    let isMounted = true;
    const fetchState = async () => {
      try {
        const state = await window.electronAPI.chromeMonitor.getState();
        if (isMounted) {
          setChromeState(state);
        }
      } catch {
        // silently ignore
      }
    };

    void fetchState();
    const unsubscribe = window.electronAPI.chromeMonitor.onStateChange((state) => {
      setChromeState(state);
    });

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    chromeEnabledRef.current = !!chromeState?.enabled;
  }, [chromeState?.enabled]);

  useEffect(() => {
    const unsubscribe = window.electronAPI.chromeMonitor.onTelemetry((event: ChromeTelemetryEvent) => {
      if (!chromeEnabledRef.current) {
        return;
      }
      if (event.kind === "console") {
        const { level, text, url } = event.entry;
        const formatted = url ? `${text} (${url})` : text;
        const toastFn =
          level === "error" ? toast.error : level === "warning" ? toast.warning : toast.info;
        toastFn(`Chrome console [${level}]: ${formatted}`);
      } else {
        const { method, status, url, mimeType } = event.entry;
        const statusPart = status ? ` status=${status}` : "";
        const mimePart = mimeType ? ` mime=${mimeType}` : "";
        toast.info(`Chrome network [${method ?? "GET"}]: ${url}${statusPart}${mimePart}`);
      }
    });

    return () => {
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!isYoutubeUrlWorkflowEnabled) {
      setYoutubeUrl("");
      setIsProcessingUrl(false);
    }
  }, [isYoutubeUrlWorkflowEnabled]);

  const handleStartRecording = async (sourceId: string) => {
    setPickerOpen(false);
    await startChromeCapture();
    await start(sourceId);
  };

  const resetPreview = () => {
    setPreviewOpen(false);
    setRecordedVideo(null);
  };

  const handleRetry = () => {
    resetPreview();
    setPickerOpen(true);
  };

  const handleContinue = async () => {
    if (!recordedVideo) return;

    const { filePath } = recordedVideo;
    resetPreview();

    try {
      setUploadStatus(UploadStatus.UPLOADING);
      setUploadResult(null);
      await window.electronAPI.pipelines.processVideoFile(filePath);
    } catch (error) {
      setUploadStatus(UploadStatus.ERROR);
      const message = formatErrorMessage(error);
      setUploadResult({ success: false, error: message });
      toast.error(`Processing failed: ${message}`);
    }
  };

  const handleYoutubeUrlChange = (event: ChangeEvent<HTMLInputElement>) => {
    setYoutubeUrl(event.target.value);
  };

  const handleProcessYoutubeUrl = async () => {
    const trimmedUrl = youtubeUrl.trim();

    if (!trimmedUrl) {
      toast.error("Link is empty");
      return;
    }

    if (!isValidYouTubeUrl(trimmedUrl)) {
      return;
    }

    setIsProcessingUrl(true);
    setUploadStatus(UploadStatus.UPLOADING);
    setUploadResult(null);

    try {
      await window.electronAPI.pipelines.processVideoUrl(trimmedUrl);
      setYoutubeUrl("");
    } catch (error) {
      setUploadStatus(UploadStatus.ERROR);
      const message = formatErrorMessage(error);
      setUploadResult({ success: false, error: message });
      toast.error(`Processing failed: ${message}`);
    } finally {
      setIsProcessingUrl(false);
    }
  };

  const isValidYouTubeUrl = (url: string): boolean => {
    try {
      const { hostname } = new URL(url);
      return (
        hostname === "youtu.be" ||
        hostname === "youtube.com" ||
        hostname === "www.youtube.com" ||
        hostname === "m.youtube.com"
      );
    } catch {
      toast.error("Please provide a valid YouTube URL");
      return false;
    }
  };

  const handleOpenMonitoredChrome = async () => {
    setIsOpeningChrome(true);
    try {
      const result = await window.electronAPI.chromeMonitor.openMonitoredChrome();
      if (!result.success) {
        toast.error(result.message ?? "Failed to launch monitored Chrome");
      } else {
        const message = result.message ?? "Monitored Chrome launched";
        toast.success(message);
      }
    } catch (error) {
      toast.error(`Unable to launch Chrome: ${formatErrorMessage(error)}`);
    } finally {
      setIsOpeningChrome(false);
    }
  };

  return (
    <>
      <section className="flex flex-col gap-4 items-center w-full">
        <div className="flex flex-row items-center gap-2">
          <Button
            className="bg-ssw-red text-ssw-red-foreground hover:bg-ssw-red/90"
            onClick={toggleRecording}
            disabled={isProcessing || isTranscribing || !isAuthenticated}
          >
            {isRecording
              ? "Stop Recording"
              : isTranscribing
                ? "Transcribing..."
                : "Start Recording"}
          </Button>
          {chromeState?.enabled && (
            <Button
              type="button"
              variant="outline"
              onClick={handleOpenMonitoredChrome}
              disabled={isProcessing || isTranscribing || isOpeningChrome}
            >
              {isOpeningChrome ? "Launching Chrome..." : "Open Monitored Chrome"}
            </Button>
          )}
        </div>
        {!isAuthenticated && (
          <p className="text-sm text-muted-foreground text-center">
            Please connect a video platform below to start recording
          </p>
        )}
        {isYoutubeUrlWorkflowEnabled && (
          <div className="max-w-6xl p-4 flex flex-col gap-2">
            <div className="flex items-center">
              <Label htmlFor={youtubeUrlInputId} className="text-sm">
                Process an existing YouTube link
              </Label>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                id={youtubeUrlInputId}
                type="url"
                placeholder="https://www.youtube.com/watch?v=..."
                value={youtubeUrl}
                onChange={handleYoutubeUrlChange}
                className="flex-1"
              />
              <Button
                type="button"
                variant="secondary"
                onClick={handleProcessYoutubeUrl}
                disabled={!youtubeUrl.trim() || isProcessingUrl}
              >
                {isProcessingUrl ? "Processing..." : "Process Link"}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Paste any published YouTube URL to kick off workflow processing without recording.
            </p>
          </div>
        )}
        <SourcePickerDialog
          open={pickerOpen}
          onOpenChange={setPickerOpen}
          onSelect={handleStartRecording}
        />
      </section>

      {recordedVideo && (
        <VideoPreviewModal
          open={previewOpen}
          videoBlob={recordedVideo.blob}
          videoFilePath={recordedVideo.filePath}
          onClose={resetPreview}
          onRetry={handleRetry}
          onContinue={handleContinue}
        />
      )}
    </>
  );
}
