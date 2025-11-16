import { type KeyboardEvent, useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { useAdvancedSettings } from "../../contexts/AdvancedSettingsContext";
import { useYouTubeAuth } from "../../contexts/YouTubeAuthContext";
import { useScreenRecording } from "../../hooks/useScreenRecording";
import { AuthStatus, UploadStatus } from "../../types";
import { formatErrorMessage } from "../../utils";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { SourcePickerDialog } from "./SourcePickerDialog";
import { VideoPreviewModal } from "./VideoPreviewModal";

interface RecordedVideo {
  blob: Blob;
  filePath: string;
}

export function ScreenRecorder() {
  const { authState, setUploadResult, setUploadStatus } = useYouTubeAuth();
  const { isRecording, isProcessing, start, stop } = useScreenRecording();
  const [isTranscribing, _] = useState(false);
  const { settings } = useAdvancedSettings();

  const [pickerOpen, setPickerOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [recordedVideo, setRecordedVideo] = useState<RecordedVideo | null>(null);
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [isProcessingUrl, setIsProcessingUrl] = useState(false);

  const isAuthenticated = authState.status === AuthStatus.AUTHENTICATED;

  const handleStopRecording = useCallback(async () => {
    const result = await stop();
    if (result) {
      setRecordedVideo(result);
      setPreviewOpen(true);
      await window.electronAPI.screenRecording.restoreMainWindow();
    }
  }, [stop]);

  const toggleRecording = () => {
    isRecording ? handleStopRecording() : setPickerOpen(true);
  };

  useEffect(() => {
    const cleanup = window.electronAPI.screenRecording.onStopRequest(handleStopRecording);
    return cleanup;
  }, [handleStopRecording]);

  const handleStartRecording = async (sourceId: string) => {
    setPickerOpen(false);
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

      await window.electronAPI.pipelines.processVideo(filePath);
    } catch (error) {
      setUploadStatus(UploadStatus.ERROR);
      const message = error instanceof Error ? error.message : String(error);
      setUploadResult({ success: false, error: message });
      toast.error(`Processing failed: ${message}`);
    }
  };

  const handleProcessYoutubeUrl = async () => {
    const trimmedUrl = youtubeUrl.trim();
    if (!trimmedUrl) {
      toast.error("Please enter a YouTube URL to process.");
      return;
    }

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(trimmedUrl);
    } catch {
      toast.error("That doesn't look like a valid URL.");
      return;
    }

    const hostname = parsedUrl.hostname.toLowerCase();
    const isYouTubeHost = hostname.includes("youtube.com") || hostname.includes("youtu.be");
    if (!isYouTubeHost) {
      toast.error("Only YouTube URLs are supported for this workflow.");
      return;
    }

    setIsProcessingUrl(true);
    setUploadStatus(UploadStatus.UPLOADING);
    setUploadResult(null);

    try {
      await window.electronAPI.pipelines.processVideo({ youtubeUrl: trimmedUrl });
      setYoutubeUrl("");
    } catch (error) {
      const message = formatErrorMessage(error);
      setUploadStatus(UploadStatus.ERROR);
      setUploadResult({ success: false, error: message });
      toast.error(`Processing failed: ${message}`);
    } finally {
      setIsProcessingUrl(false);
    }
  };

  const disableYoutubeProcessing =
    !youtubeUrl.trim() || isProcessingUrl || isProcessing || isTranscribing || !isAuthenticated;

  const handleYoutubeInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      if (!disableYoutubeProcessing) {
        void handleProcessYoutubeUrl();
      }
    }
  };

  return (
    <>
      <section className="flex flex-col gap-4 items-center w-full">
        <div className="flex flex-row items-center gap-2">
          <Button
            className="bg-red-600 hover:bg-red-700"
            onClick={toggleRecording}
            disabled={isProcessing || isTranscribing || !isAuthenticated}
          >
            {isRecording
              ? "Stop Recording"
              : isTranscribing
                ? "Transcribing..."
                : "Start Recording"}
          </Button>
        </div>
        {!isAuthenticated && (
          <p className="text-sm text-white/60 text-center">
            Please connect a video platform below to start recording
          </p>
        )}
        <SourcePickerDialog
          open={pickerOpen}
          onOpenChange={setPickerOpen}
          onSelect={handleStartRecording}
        />

        {settings.enableYoutubeUrlImport && (
          <div className="w-full max-w-xl mt-4 space-y-2">
            <label htmlFor="youtube-url-input" className="text-sm text-white/80 font-medium">
              Process an existing YouTube video
            </label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                id="youtube-url-input"
                type="url"
                placeholder="https://www.youtube.com/watch?v=..."
                value={youtubeUrl}
                disabled={!isAuthenticated || isProcessingUrl}
                onChange={(event) => setYoutubeUrl(event.target.value)}
                onKeyDown={handleYoutubeInputKeyDown}
                className="bg-white/5 border-white/20 text-white flex-1"
              />
              <Button
                type="button"
                onClick={() => void handleProcessYoutubeUrl()}
                disabled={disableYoutubeProcessing}
                className="min-w-[120px]"
              >
                {isProcessingUrl ? "Processing..." : "Process"}
              </Button>
            </div>
            <p className="text-xs text-white/60">
              YakShaver will download the video and run the same workflow as a fresh recording.
            </p>
          </div>
        )}
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
