import type { ToolApprovalMode, UserSettings } from "@shared/types/user-settings";
import { CircleStopIcon, Upload } from "lucide-react";
import { type ChangeEvent, useCallback, useEffect, useId, useState } from "react";
import { toast } from "sonner";
import { useShaveManager } from "@/hooks/useShaveManager";
import { useWorkflowNavigation } from "@/hooks/useWorkflowNavigation";
import { cn } from "@/lib/utils";
import { ipcClient } from "@/services/ipc-client";
import { formatErrorMessage } from "@/utils";
import { VideoSourceType } from "../../../../backend/types";
import { normalizeYouTubeUrl } from "../../../../backend/utils/youtube-url-utils";
import { useAdvancedSettings } from "../../contexts/AdvancedSettingsContext";
import { useYouTubeAuth } from "../../contexts/YouTubeAuthContext";
import { useScreenRecording } from "../../hooks/useScreenRecording";
import { AuthStatus, ShaveStatus, UploadStatus } from "../../types";
import { Cloud360ProjectDialog } from "../cloud360/Cloud360ProjectDialog";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Kbd } from "../ui/kbd";
import { Label } from "../ui/label";
import { SourcePickerDialog } from "./SourcePickerDialog";
import { useCloud360Mode } from "./useCloud360Mode";
import { VideoPreviewModal } from "./VideoPreviewModal";

interface RecordedVideo {
  blob: Blob;
  filePath: string;
  fileName: string;
}

interface ScreenRecorderProps {
  showButtonOnly?: boolean;
  className?: string;
}

interface RecordButtonProps {
  isRecording: boolean;
  isTranscribing: boolean;
  isDisabled: boolean;
  // Renders the split-button shell (and its "Record"/"Stop" label/layout)
  // whenever the YouTube-URL workflow is enabled. This is intentionally
  // decoupled from `showUploadAction` so hiding the upload sub-button after a
  // video is committed does NOT relabel/reshape the primary record button.
  showSplitLayout: boolean;
  // Renders the right-hand Upload sub-button. Only meaningful when
  // `showSplitLayout` is true (the single-button shell has no slot for it).
  showUploadAction: boolean;
  onToggleRecording: () => void;
  onUploadClick: () => void;
  className?: string;
}

function RecordButton({
  isRecording,
  isTranscribing,
  isDisabled,
  showSplitLayout,
  showUploadAction,
  onToggleRecording,
  onUploadClick,
  className = "",
}: RecordButtonProps) {
  let label = showSplitLayout ? "Record" : "Start Recording";
  if (isRecording) label = showSplitLayout ? "Stop" : "Stop Recording";
  else if (isTranscribing) label = "Transcribing...";

  if (!showSplitLayout) {
    return (
      <Button
        className={cn(
          "bg-ssw-red text-xl text-ssw-red-foreground hover:bg-ssw-red/90 items-center",
          className,
        )}
        onClick={onToggleRecording}
        size="chunky"
        disabled={isDisabled}
      >
        <CircleStopIcon className="w-5 h-5" />
        {label}
      </Button>
    );
  }

  return (
    <div className={cn("flex w-full rounded-md overflow-hidden", className)}>
      <Button
        className={cn(
          "flex-1 bg-ssw-red text-xl text-ssw-red-foreground hover:bg-ssw-red/90 items-center justify-start rounded-none rounded-l-md",
          // When the upload sub-button is hidden, the primary button owns the
          // full pill, so round its right edge too.
          !showUploadAction && "rounded-r-md",
        )}
        onClick={onToggleRecording}
        size="chunky"
        disabled={isDisabled}
      >
        <CircleStopIcon />
        {label}
      </Button>
      {showUploadAction && (
        <>
          <div className="w-px bg-ssw-red-foreground/20" />
          <Button
            className="bg-ssw-red text-ssw-red-foreground hover:bg-ssw-red/90 rounded-none rounded-r-md px-3"
            size="chunky"
            onClick={onUploadClick}
            disabled={isDisabled}
            title="Process YouTube URL"
          >
            <Upload className="h-4 w-4" />
          </Button>
        </>
      )}
    </div>
  );
}

export function ScreenRecorder({ showButtonOnly = false, className = "" }: ScreenRecorderProps) {
  const navigateToWorkflow = useWorkflowNavigation({ listen: false });
  const { authState, setUploadResult, setUploadStatus } = useYouTubeAuth();
  const { isYoutubeUrlWorkflowEnabled } = useAdvancedSettings();
  const { isRecording, isProcessing, start, stop } = useScreenRecording();
  const [isTranscribing, _] = useState(false);
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [isProcessingUrl, setIsProcessingUrl] = useState(false);
  const youtubeUrlInputId = useId();
  const [recordHotkey, setRecordHotkey] = useState("");

  const [youtubeDialogOpen, setYoutubeDialogOpen] = useState(false);
  const [videoCommitted, setVideoCommitted] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [recordedVideo, setRecordedVideo] = useState<RecordedVideo | null>(null);
  const [duration, setDuration] = useState<number>(0);
  const [approvalMode, setApprovalMode] = useState<ToolApprovalMode>("ask");
  const { saveRecording, checkExistingShave } = useShaveManager();
  const { is360Mode, isSignedIn } = useCloud360Mode();
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [projectDialogOpen, setProjectDialogOpen] = useState(false);

  const isAuthenticated = authState.status === AuthStatus.AUTHENTICATED;
  // Project selection happens *after* Record is clicked (Cloud360ProjectDialog),
  // so gating on selectedProjectId here would make the button permanently
  // disabled and the dialog unreachable. The dialog's own "Start recording"
  // button enforces project selection downstream.
  const recordDisabled = is360Mode
    ? isProcessing || isTranscribing || !isSignedIn
    : isProcessing || isTranscribing || !isAuthenticated;

  // The "Process YouTube link" affordance is only relevant before any video has
  // been committed for processing. Once a video is committed — via EITHER the
  // recording path (handleContinue) or a successful URL submit
  // (handleProcessYoutubeUrl) — or a recording is in progress, we hide it,
  // because the app does not yet support processing multiple videos in parallel
  // (#775). Both commit paths consume the same single-video slot, so the gate is
  // symmetric across them.
  //
  // We track this with a dedicated session flag (`videoCommitted`) rather than
  // reusing the session-global `uploadStatus`, which is ALSO driven to ERROR by
  // a *failed* URL submit and the workflow-progress listener — so a failed URL
  // submit must not latch this affordance off and strip the user's only way to
  // retry the URL workflow.
  const hasVideoBeenCommitted = isRecording || videoCommitted;
  // Show the upload sub-button (the entry to the URL dialog) only before a video
  // is committed. This is decoupled from the split-button shell below so hiding
  // it does not relabel/reshape the primary record button (#775 asked only to
  // hide this control, not to restyle the record button).
  const showProcessYoutubeLink = isYoutubeUrlWorkflowEnabled && !hasVideoBeenCommitted;

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

  useEffect(() => {
    const loadHotkey = async () => {
      try {
        const settings = await ipcClient.userSettings.get();
        if (settings.hotkeys.startRecording) {
          setRecordHotkey(settings.hotkeys.startRecording);
        }
        setApprovalMode(settings.toolApprovalMode ?? "ask");
      } catch (error) {
        console.error("Failed to load hotkey settings:", error);
      }
    };
    loadHotkey();

    // Listen for setting changes
    const unsubscribe = window.electronAPI.userSettings.onHotkeyUpdate(
      (hotkeys: UserSettings["hotkeys"]) => {
        if (hotkeys?.startRecording !== undefined) {
          setRecordHotkey(hotkeys.startRecording || "");
        }
      },
    );

    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!previewOpen) return;
    ipcClient.userSettings
      .get()
      .then((settings) => setApprovalMode(settings.toolApprovalMode ?? "ask"))
      .catch((error) => console.error("Failed to refresh approval mode:", error));
  }, [previewOpen]);

  const toggleRecording = () => {
    if (isRecording) {
      handleStopRecording();
      return;
    }
    // In 360 mode, pick a project first; confirming opens the source picker.
    if (is360Mode) {
      setProjectDialogOpen(true);
      return;
    }
    setPickerOpen(true);
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

  const handleContinue = async (shaveAutoApprove: boolean) => {
    if (!recordedVideo) return;

    // Validate that duration was loaded
    if (duration === undefined || duration === 0) {
      toast.error("Video duration not loaded. Please wait a moment and try again.");
      return;
    }

    const { filePath, fileName } = recordedVideo;
    const audioCheck = await window.electronAPI.screenRecording.hasAudio(filePath);
    if (audioCheck?.success && audioCheck.hasAudio === false) {
      toast.error(
        "No audio detected in this recording. Please re-record and make sure the correct microphone is selected and unmuted.",
      );
      return;
    }

    resetPreview();
    // A recording has now been committed for processing; hide the
    // Process-YouTube-link affordance for the rest of the session (#775).
    setVideoCommitted(true);

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
      if (!newShave?.id && shaveAutoApprove) {
        toast.warning(
          "Auto-approve is unavailable — shave record could not be created. You will be prompted for confirmations.",
        );
      }
      //Process video even if Shave creation failed, do not block user
      await window.electronAPI.pipelines.processVideoFile(
        filePath,
        newShave?.id,
        shaveAutoApprove,
        is360Mode ? (selectedProjectId ?? undefined) : undefined,
      );
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
      let shaveId: string | undefined;
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
      // A URL has now been committed for processing; it consumes the same
      // single-video slot as a recording, so hide the Process-YouTube-link
      // affordance for the rest of the session — symmetric with the recording
      // path in handleContinue (#775). Set only on success so a failed submit
      // leaves the user able to retry.
      setVideoCommitted(true);
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
        <div className="flex flex-col items-center gap-1 w-full">
          <RecordButton
            isRecording={isRecording}
            isTranscribing={isTranscribing}
            isDisabled={recordDisabled}
            showSplitLayout={isYoutubeUrlWorkflowEnabled}
            showUploadAction={showProcessYoutubeLink}
            onToggleRecording={toggleRecording}
            onUploadClick={() => setYoutubeDialogOpen(true)}
            className={className}
          />
          {!isRecording && !isTranscribing && recordHotkey && !showButtonOnly && (
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              Keyboard:{" "}
              {recordHotkey.split("+").map((key, index, parts) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: order of keys in a shortcut is stable
                <span key={index} className="flex items-center gap-1">
                  <Kbd>{key}</Kbd>
                  {index < parts.length - 1 && <span aria-hidden="true">+</span>}
                </span>
              ))}
            </p>
          )}
        </div>
        {!is360Mode && !isAuthenticated && !showButtonOnly && (
          <p className="text-sm text-muted-foreground text-center">
            Please connect a video platform below to start recording
          </p>
        )}
        <SourcePickerDialog
          open={pickerOpen}
          onOpenChange={setPickerOpen}
          onSelect={handleStartRecording}
        />
      </section>

      <Dialog open={youtubeDialogOpen} onOpenChange={setYoutubeDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Process YouTube Link</DialogTitle>
            <DialogDescription>
              Paste a published YouTube URL to process without recording.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Label htmlFor={youtubeUrlInputId}>YouTube URL</Label>
            <Input
              id={youtubeUrlInputId}
              type="url"
              placeholder="https://www.youtube.com/watch?v=..."
              value={youtubeUrl}
              onChange={handleYoutubeUrlChange}
            />
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setYoutubeDialogOpen(false)}
              disabled={isProcessingUrl}
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                navigateToWorkflow();
                handleProcessYoutubeUrl();
                setYoutubeDialogOpen(false);
              }}
              disabled={!youtubeUrl.trim() || isProcessingUrl}
            >
              {isProcessingUrl ? "Processing..." : "Process Link"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Cloud360ProjectDialog
        open={projectDialogOpen}
        onOpenChange={setProjectDialogOpen}
        onConfirm={(projectId) => {
          setSelectedProjectId(projectId);
          setPickerOpen(true);
        }}
      />

      {recordedVideo && (
        <VideoPreviewModal
          open={previewOpen}
          videoBlob={recordedVideo.blob}
          videoFilePath={recordedVideo.filePath}
          approvalMode={approvalMode}
          is360Mode={is360Mode}
          onClose={resetPreview}
          onRetry={handleRetry}
          onContinue={handleContinue}
          onDurationLoad={handleDurationLoad}
        />
      )}
    </>
  );
}
