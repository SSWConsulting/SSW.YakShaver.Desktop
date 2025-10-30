import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { useYouTubeAuth } from "../../contexts/YouTubeAuthContext";
import { useScreenRecording } from "../../hooks/useScreenRecording";
import { AuthStatus, UploadStatus, VideoUploadResult } from "../../types";
import { McpServerManager } from "../mcp/McpServerManager";
import { OpenAIKeyManager } from "../openai/OpenAIKeyManager";
import { CustomPromptDialog } from "../settings/CustomPromptDialog";
import { Button } from "../ui/button";
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

  const [pickerOpen, setPickerOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [recordedVideo, setRecordedVideo] = useState<RecordedVideo | null>(null);

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

      // TODO: refactor - below logic should be moved to the backend, in a linear process pipeline, to avoid back and forth inter process communication
      // for the visual update we could use webContents.send() to notify the UI of progress updates
      // we need to refactor all the similar logic in other places as well
      const videoUploadResult : VideoUploadResult = await window.electronAPI.youtube.uploadRecordedVideo(filePath);
      await window.electronAPI.screenRecording.triggerTranscription(filePath, videoUploadResult);

      setUploadResult(videoUploadResult);
      setUploadStatus(
        videoUploadResult.success ? UploadStatus.SUCCESS : UploadStatus.ERROR,
      );

      if (videoUploadResult.success) {
        toast.success("Video uploaded successfully!");
      } else {
        toast.error(`Upload failed: ${videoUploadResult.error}`);
      }
    } catch (error) {
      toast.error(`Processing failed: ${error}`);
    } finally {
      //TODO: refactor - cleanup of temp files should also be handled in the backend
      //await window.electronAPI.screenRecording.cleanupTempFile(filePath);
    }
  };

  return (
    <>
      <section className="flex flex-col gap-4 items-center">
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
          <McpServerManager />
          <CustomPromptDialog />
          <OpenAIKeyManager />
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
