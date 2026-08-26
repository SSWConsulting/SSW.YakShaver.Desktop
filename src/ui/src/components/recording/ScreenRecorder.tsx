import type { ToolApprovalMode, UserSettings } from "@shared/types/user-settings";
import { AlertTriangle, Circle, Square, Upload } from "lucide-react";
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
import { Badge } from "../ui/badge";
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

// #1022 — opens Settings directly on the Video Host tab, reusing the same
// decoupled "open-settings-tab" event HomeMcpStatusBanner (#869) uses so
// ScreenRecorder doesn't need to know about SettingsDialog's internals.
function openVideoHostSettings() {
  window.dispatchEvent(new CustomEvent("open-settings-tab", { detail: { tabId: "videoHost" } }));
}

interface RecordedVideo {
  blob: Blob;
  filePath: string;
  fileName: string;
}

interface ScreenRecorderProps {
  showButtonOnly?: boolean;
  className?: string;
}

interface RecorderControlState {
  isRecording: boolean;
  isTranscribing: boolean;
  isProcessing: boolean;
  isProcessingUrl: boolean;
  isVideoHostConnected: boolean;
}

interface RecorderControlAvailability {
  recordDisabled: boolean;
  // #1022 — set only when Record is disabled specifically because no video
  // host is connected (not for the transient isProcessing/isTranscribing
  // causes), so the tooltip/inline message stay scoped to the actionable case.
  recordDisabledReason: string | null;
  uploadDisabled: boolean;
  uploadTitle: string;
  recordLabel: string;
}

interface RecordButtonProps {
  controlAvailability: RecorderControlAvailability;
  // Renders the split-button shell (and its "Record"/"Stop" label/layout)
  // whenever the YouTube-URL workflow is enabled.
  showSplitLayout: boolean;
  // Drives which icon (filled record circle vs. filled stop square) the
  // button shows; kept separate from controlAvailability since that type is
  // about availability/disabled state, not raw recording state (issue #641).
  isRecording: boolean;
  onToggleRecording: () => void;
  onUploadClick: () => void;
  className?: string;
}

// Filled record (circle) / stop (square) icon, matching the acceptance
// criteria for issue #641. `aria-hidden` since the button's accessible
// name/label already conveys the meaning via text.
function RecordIcon({ isRecording, className }: { isRecording: boolean; className?: string }) {
  return isRecording ? (
    <Square aria-hidden="true" fill="currentColor" className={className} />
  ) : (
    <Circle aria-hidden="true" fill="currentColor" className={className} />
  );
}

const PROCESS_YOUTUBE_URL_LABEL = "Process YouTube URL";

// #1022 — shared copy for the tooltip, inline banner, and screen-reader
// description, so all three surfaces describing the same disabled reason
// stay in sync.
const VIDEO_HOST_DISABLED_REASON = "Recording requires a connected video host.";

function getRecordLabel(controlState: RecorderControlState, showSplitLayout: boolean) {
  if (controlState.isRecording) return showSplitLayout ? "Stop" : "Stop Recording";
  if (controlState.isTranscribing) return "Transcribing...";
  return showSplitLayout ? "Record" : "Start Recording";
}

function getRecorderControlAvailability(
  controlState: RecorderControlState,
  showSplitLayout: boolean,
): RecorderControlAvailability {
  const missingVideoHost = !controlState.isRecording && !controlState.isVideoHostConnected;
  const recordDisabled =
    controlState.isProcessing || controlState.isTranscribing || missingVideoHost;
  const uploadDisabled = recordDisabled || controlState.isRecording;

  // #1022 — only the missing-video-host cause gets a reason; it's the one
  // actionable cause (the others are transient app states with no user
  // action to take), so the tooltip/inline message stay scoped to it.
  const recordDisabledReason = missingVideoHost ? VIDEO_HOST_DISABLED_REASON : null;

  let uploadTitle = PROCESS_YOUTUBE_URL_LABEL;
  if (controlState.isRecording) {
    uploadTitle = `${PROCESS_YOUTUBE_URL_LABEL} (unavailable while recording)`;
  } else if (!controlState.isVideoHostConnected) {
    uploadTitle = `${PROCESS_YOUTUBE_URL_LABEL} (unavailable until a video host is connected)`;
  } else if (recordDisabled) {
    uploadTitle = `${PROCESS_YOUTUBE_URL_LABEL} (unavailable right now)`;
  }

  return {
    recordDisabled,
    recordDisabledReason,
    uploadDisabled,
    uploadTitle,
    recordLabel: getRecordLabel(controlState, showSplitLayout),
  };
}

function RecordButton({
  controlAvailability,
  showSplitLayout,
  isRecording,
  onToggleRecording,
  onUploadClick,
  className = "",
}: RecordButtonProps) {
  const { recordDisabled, recordDisabledReason, uploadDisabled, uploadTitle, recordLabel } =
    controlAvailability;
  const uploadDescriptionId = useId();
  const recordDescriptionId = useId();
  const handleUploadClick = useCallback(() => {
    if (uploadDisabled) {
      return;
    }

    onUploadClick();
  }, [onUploadClick, uploadDisabled]);

  if (!showSplitLayout) {
    return (
      // #1022 — `title` wraps the (natively) disabled button so hover still
      // shows the reason: a native `disabled` button suppresses its own
      // pointer/focus events, so the tooltip has to live on a parent that
      // still receives them. Mirrors the upload button's wrapper below.
      <div title={recordDisabledReason ?? undefined}>
        <Button
          className={cn(
            "bg-ssw-red text-xl text-ssw-red-foreground hover:bg-ssw-red/90 items-center",
            className,
          )}
          onClick={onToggleRecording}
          size="chunky"
          disabled={recordDisabled}
          aria-describedby={recordDisabledReason ? recordDescriptionId : undefined}
        >
          <RecordIcon isRecording={isRecording} className="w-5 h-5" />
          {recordLabel}
        </Button>
        {recordDisabledReason && (
          <span id={recordDescriptionId} className="sr-only">
            {recordDisabledReason}
          </span>
        )}
      </div>
    );
  }

  return (
    <div className={cn("flex w-full rounded-md overflow-hidden", className)}>
      <div className="flex-1 rounded-none rounded-l-md" title={recordDisabledReason ?? undefined}>
        <Button
          className="w-full bg-ssw-red text-xl text-ssw-red-foreground hover:bg-ssw-red/90 items-center justify-start rounded-none rounded-l-md"
          onClick={onToggleRecording}
          size="chunky"
          disabled={recordDisabled}
          aria-describedby={recordDisabledReason ? recordDescriptionId : undefined}
        >
          <RecordIcon isRecording={isRecording} />
          {recordLabel}
        </Button>
        {recordDisabledReason && (
          <span id={recordDescriptionId} className="sr-only">
            {recordDisabledReason}
          </span>
        )}
      </div>
      <div className="w-px bg-ssw-red-foreground/20" />
      {/* Keep the unavailable upload action focusable: native disabled buttons
          leave the tab order, so keyboard and screen-reader users would miss
          the explanatory text this state exists to provide. */}
      <div className="rounded-none rounded-r-md" title={uploadTitle}>
        <Button
          className={cn(
            "bg-ssw-red text-ssw-red-foreground hover:bg-ssw-red/90 rounded-none rounded-r-md px-3",
            uploadDisabled && "opacity-50 cursor-not-allowed",
          )}
          size="chunky"
          onClick={handleUploadClick}
          aria-disabled={uploadDisabled}
          aria-label={PROCESS_YOUTUBE_URL_LABEL}
          aria-describedby={uploadDisabled ? uploadDescriptionId : undefined}
        >
          <Upload className="h-4 w-4" />
        </Button>
        {uploadDisabled && (
          <span id={uploadDescriptionId} className="sr-only">
            {uploadTitle}
          </span>
        )}
      </div>
    </div>
  );
}

export function ScreenRecorder({ showButtonOnly = false, className = "" }: ScreenRecorderProps) {
  const navigateToWorkflow = useWorkflowNavigation();
  const { authState, setUploadResult, setUploadStatus } = useYouTubeAuth();
  const { isYoutubeUrlWorkflowEnabled } = useAdvancedSettings();
  const { isRecording, isProcessing, start, stop } = useScreenRecording();
  const [isTranscribing, _] = useState(false);
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [isProcessingUrl, setIsProcessingUrl] = useState(false);
  const youtubeUrlInputId = useId();
  const [recordHotkey, setRecordHotkey] = useState("");

  const [youtubeDialogOpen, setYoutubeDialogOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [recordedVideo, setRecordedVideo] = useState<RecordedVideo | null>(null);
  const [duration, setDuration] = useState<number>(0);
  const [approvalMode, setApprovalMode] = useState<ToolApprovalMode>("ask");
  const { saveRecording, checkExistingShave } = useShaveManager();
  const { is360Mode, isSignedIn } = useCloud360Mode();
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [projectDialogOpen, setProjectDialogOpen] = useState(false);

  // In 360 mode the "video host" is Identity Server sign-in (isSignedIn), not the
  // YouTube/video-platform auth used by the standard flow. Feeding this into the
  // shared control-availability model keeps Record enable/disable correct for both
  // modes through one path. Project selection happens *after* Record is clicked
  // (Cloud360ProjectDialog), so it is intentionally not part of this gate.
  const isVideoHostConnected = is360Mode
    ? isSignedIn
    : authState.status === AuthStatus.AUTHENTICATED;
  const controlState = {
    isRecording,
    isTranscribing,
    isProcessing,
    isProcessingUrl,
    isVideoHostConnected,
  } satisfies RecorderControlState;
  // 360 has no YouTube-URL path, so keep a single Record button (no split layout).
  const showYoutubeUrlSplitLayout = !is360Mode && isYoutubeUrlWorkflowEnabled && !isRecording;
  const controlAvailability = getRecorderControlAvailability(
    controlState,
    showYoutubeUrlSplitLayout,
  );

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
    try {
      setUploadStatus(UploadStatus.UPLOADING);
      setUploadResult(null);

      // 360 is self-contained; skip the local shave record and pass duration through.
      if (is360Mode) {
        const result = await window.electronAPI.pipelines.processVideoFile(
          filePath,
          undefined,
          shaveAutoApprove,
          selectedProjectId ?? undefined,
          duration,
        );
        setUploadStatus(result?.success === false ? UploadStatus.ERROR : UploadStatus.IDLE);
        return;
      }

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
      const newShave = result.data;
      if (!result.success) {
        toast.error("Could not save to My Shaves", {
          description:
            "Video processing will continue, but we couldn't save this shave to My Shaves.",
        });
      }
      if (!newShave?.id && shaveAutoApprove) {
        toast.warning(
          "Auto-approve is unavailable — shave record could not be created. You will be prompted for confirmations.",
        );
      }
      //Process video even if Shave creation failed, do not block user
      await window.electronAPI.pipelines.processVideoFile(filePath, newShave?.id, shaveAutoApprove);
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
    if (controlAvailability.uploadDisabled) {
      return;
    }

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
      let shaveId = await checkExistingShave(trimmedUrl);
      if (shaveId) {
        const resetResult = await ipcClient.shave.updateStatus(shaveId, ShaveStatus.Processing);
        if (!resetResult.success) {
          setUploadStatus(UploadStatus.ERROR);
          setUploadResult({
            success: false,
            error: resetResult.error || "Could not prepare this shave for a new workflow",
          });
          return;
        }
      } else {
        const result = await saveRecording({
          clientOrigin: "YakShaver Desktop",
          title: "Untitled",
          shaveStatus: ShaveStatus.Pending,
          videoEmbedUrl: normalizeYouTubeUrl(trimmedUrl),
        });
        if (!result.success || !result.data?.id) {
          setUploadStatus(UploadStatus.ERROR);
          setUploadResult({
            success: false,
            error: result.error || "Could not create a shave for this workflow",
          });
          return;
        }
        shaveId = result.data.id;
      }

      const processing = window.electronAPI.pipelines.processVideoUrl(trimmedUrl, shaveId);
      navigateToWorkflow({ shaveId });
      await processing;
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

  const handleSubmitYoutubeUrl = () => {
    if (controlAvailability.uploadDisabled) {
      return;
    }

    handleProcessYoutubeUrl();
    setYoutubeDialogOpen(false);
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

  // #1022 — 360 mode has its own "sign in" gate (isSignedIn, surfaced
  // elsewhere in that flow), so the video-host status indicator/banner below
  // is scoped to the standard (non-360) flow, matching the existing
  // `!is360Mode && !isVideoHostConnected` guard this replaces.
  const showVideoHostWarning = !is360Mode && !isVideoHostConnected && !showButtonOnly;

  return (
    <>
      <section className="flex flex-col gap-4 items-center w-full">
        <div className="flex flex-col items-center gap-1 w-full">
          <RecordButton
            controlAvailability={controlAvailability}
            showSplitLayout={showYoutubeUrlSplitLayout}
            isRecording={isRecording}
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
          {/* #1022 — status indicator near the record button showing video
              host connection state, independent of the (more prominent)
              banner below so the state is visible at a glance even once the
              banner has been dismissed-by-familiarity. */}
          {!is360Mode && !showButtonOnly && (
            <Badge
              variant={isVideoHostConnected ? "success" : "destructive"}
              className="mt-1"
              data-testid="video-host-status"
            >
              {isVideoHostConnected ? "Video host connected" : "Video host not connected"}
            </Badge>
          )}
        </div>
        {showVideoHostWarning && (
          // #1022 — a prominent, actionable banner (not just muted text) so
          // the missing-video-host reason can't be missed, with a direct link
          // to the Video Host settings tab. Mirrors HomeMcpStatusBanner (#869).
          <div
            role="alert"
            className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 w-full rounded-md border border-yellow-500/30 bg-yellow-500/10 px-4 py-3"
          >
            <div className="flex items-start gap-2 text-yellow-100">
              <AlertTriangle aria-hidden="true" className="h-5 w-5 shrink-0 text-yellow-300" />
              <span className="text-sm">{VIDEO_HOST_DISABLED_REASON} Connect one to continue.</span>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="shrink-0 self-start"
              onClick={openVideoHostSettings}
            >
              Open Video Host Settings
            </Button>
          </div>
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
              onClick={handleSubmitYoutubeUrl}
              disabled={!youtubeUrl.trim() || isProcessingUrl || controlAvailability.uploadDisabled}
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
