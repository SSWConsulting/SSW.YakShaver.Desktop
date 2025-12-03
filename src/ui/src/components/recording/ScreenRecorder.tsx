import {
  type ChangeEvent,
  useCallback,
  useEffect,
  useId,
  useState,
} from "react";
import { toast } from "sonner";
import { formatErrorMessage } from "@/utils";
import { useAdvancedSettings } from "../../contexts/AdvancedSettingsContext";
import { useYouTubeAuth } from "../../contexts/YouTubeAuthContext";
import { useScreenRecording } from "../../hooks/useScreenRecording";
import { AuthStatus, UploadStatus } from "../../types";
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
  const youtubeUrlInputId = useId();

  const [pickerOpen, setPickerOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [recordedVideo, setRecordedVideo] = useState<RecordedVideo | null>(
    null
  );

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
    const cleanup =
      window.electronAPI.screenRecording.onStopRequest(handleStopRecording);
    return cleanup;
  }, [handleStopRecording]);

  useEffect(() => {
    if (!isYoutubeUrlWorkflowEnabled) {
      setYoutubeUrl("");
      setIsProcessingUrl(false);
    }
  }, [isYoutubeUrlWorkflowEnabled]);

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
              Paste any published YouTube URL to kick off workflow processing
              without recording.
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
