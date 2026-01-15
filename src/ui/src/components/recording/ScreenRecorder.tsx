import { type ChangeEvent, useCallback, useEffect, useId, useState } from "react";
import { toast } from "sonner";
import { useShaveManager } from "@/hooks/useShaveManager";
import { formatErrorMessage } from "@/utils";
import { VideoSourceType } from "../../../../backend/types";
import { normalizeYouTubeUrl } from "../../../../backend/utils/youtube-url-utils";
import { useAdvancedSettings } from "../../contexts/AdvancedSettingsContext";
import { useYouTubeAuth } from "../../contexts/YouTubeAuthContext";
import { useScreenRecording } from "../../hooks/useScreenRecording";
import { AuthStatus, ShaveStatus, UploadStatus } from "../../types";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { SourcePickerDialog } from "./SourcePickerDialog";
import { VideoPreviewModal } from "./VideoPreviewModal";

interface RecordedVideo {
  blob: Blob;
  filePath: string;
  fileName: string;
}

export function ScreenRecorder() {
  const { authState, setUploadResult, setUploadStatus } = useYouTubeAuth();
  const { isYoutubeUrlWorkflowEnabled } = useAdvancedSettings();
  const { isRecording, isProcessing, start, stop } = useScreenRecording();
  const [isTranscribing, _] = useState(false);
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [isProcessingUrl, setIsProcessingUrl] = useState(false);
  const youtubeUrlInputId = useId();

  const [pickerOpen, setPickerOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [recordedVideo, setRecordedVideo] = useState<RecordedVideo | null>(null);
  const [duration, setDuration] = useState<number>(0);
  const [recordShortcut, setRecordShortcut] = useState<string>("PrintScreen");
  const { saveRecording, checkExistingShave } = useShaveManager();

  const isAuthenticated = authState.status === AuthStatus.AUTHENTICATED;

  const handleStopRecording = useCallback(async () => {
    const result = await stop();
    if (result) {
      setRecordedVideo(result);
      setPreviewOpen(true);
      await window.electronAPI.screenRecording.restoreMainWindow();
    }
  }, [stop]);

  const handleDurationLoad = useCallback((calculatedDuration: number) => {
    setDuration(calculatedDuration);
  }, []);

  const toggleRecording = () => {
    isRecording ? handleStopRecording() : setPickerOpen(true);
  };

  useEffect(() => {
    const cleanup = window.electronAPI.screenRecording.onStopRequest(handleStopRecording);
    return cleanup;
  }, [handleStopRecording]);

  const handleOpenSourcePicker = useCallback(() => {
    if (!isRecording) {
      setPickerOpen(true);
    }
  }, [isRecording]);

  useEffect(() => {
    const cleanup = window.electronAPI.screenRecording.onOpenSourcePicker(handleOpenSourcePicker);
    return cleanup;
  }, [handleOpenSourcePicker]);

  useEffect(() => {
    const fetchShortcut = async () => {
      try {
        const settings = await window.electronAPI.keyboardShortcut.get();
        setRecordShortcut(settings.recordShortcut);
      } catch (error) {
        console.error("Failed to fetch keyboard shortcut:", error);
      }
    };
    fetchShortcut();

    const cleanup = window.electronAPI.keyboardShortcut.onShortcutChanged((shortcut) => {
      setRecordShortcut(shortcut);
    });
    return cleanup;
  }, []);

  useEffect(() => {
    if (!isYoutubeUrlWorkflowEnabled) {
      setYoutubeUrl("");
      setIsProcessingUrl(false);
    }
  }, [isYoutubeUrlWorkflowEnabled]);

  const handleStartRecording = async (
    sourceId: string,
    devices?: { cameraId?: string; microphoneId?: string },
  ) => {
    setPickerOpen(false);
    await start(sourceId, {
      micDeviceId: devices?.microphoneId,
      cameraDeviceId: devices?.cameraId,
    });
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

    // Validate that duration was loaded
    if (duration === undefined || duration === 0) {
      toast.error("Video duration not loaded. Please wait a moment and try again.");
      return;
    }

    const { filePath, fileName } = recordedVideo;
    resetPreview();

    try {
      setUploadStatus(UploadStatus.UPLOADING);
      setUploadResult(null);
      const result = await saveRecording(
        {
          clientOrigin: "YakShaver Desktop",
          title: "Untitled",
          shaveStatus: ShaveStatus.Pending,
        },
        {
          fileName,
          localPath: filePath,
        },
        {
          type: VideoSourceType.LOCAL_RECORDING,
          durationSeconds: duration,
        },
      );
      const newShave = result?.data;
      //Process video even if Shave creation failed, do not block user
      await window.electronAPI.pipelines.processVideoFile(filePath, newShave?.id);
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
      let shaveId: number | undefined;
      const existingShaveId = await checkExistingShave(trimmedUrl);
      if (existingShaveId) {
        shaveId = existingShaveId;
      } else {
        const result = await saveRecording({
          clientOrigin: "YakShaver Desktop",
          title: "Untitled",
          shaveStatus: ShaveStatus.Pending,
          videoEmbedUrl: normalizeYouTubeUrl(trimmedUrl),
        });
        shaveId = result?.data?.id;
      }
      await window.electronAPI.pipelines.processVideoUrl(trimmedUrl, shaveId);
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
                : `Start Recording (${recordShortcut})`}
          </Button>
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
          onDurationLoad={handleDurationLoad}
        />
      )}
    </>
  );
}
