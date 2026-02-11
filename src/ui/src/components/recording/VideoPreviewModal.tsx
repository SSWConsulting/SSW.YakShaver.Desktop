import { ArrowRight, RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { VideoPlayer } from "./VideoPlayer";

interface VideoPreviewModalProps {
  open: boolean;
  videoBlob: Blob;
  videoFilePath: string;
  onClose: () => void;
  onRetry: () => void;
  onContinue: () => void;
  onDurationLoad?: (duration: number) => void;
}

export function VideoPreviewModal({
  open,
  videoBlob,
  videoFilePath,
  onClose,
  onRetry,
  onContinue,
  onDurationLoad,
}: VideoPreviewModalProps) {
  const [videoUrl, setVideoUrl] = useState("");
  const [showConfirmExit, setShowConfirmExit] = useState(false);
  const [audioCheck, setAudioCheck] = useState<
    | { status: "idle" }
    | { status: "checking" }
    | { status: "has_audio" }
    | { status: "no_audio" }
    | { status: "error"; error: string }
  >({ status: "idle" });

  useEffect(() => {
    if (!videoBlob) return;
    const url = URL.createObjectURL(videoBlob);
    setVideoUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [videoBlob]);

  useEffect(() => {
    if (!open) {
      setAudioCheck({ status: "idle" });
      return;
    }

    let cancelled = false;
    const run = async () => {
      setAudioCheck({ status: "checking" });
      const result = await window.electronAPI.screenRecording.hasAudio(videoFilePath);
      if (cancelled) return;

      if (!result?.success) {
        setAudioCheck({ status: "error", error: result?.error || "Audio check failed" });
        return;
      }

      setAudioCheck(result.hasAudio ? { status: "has_audio" } : { status: "no_audio" });
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [open, videoFilePath]);

  const cleanupFile = () => window.electronAPI.screenRecording.cleanupTempFile(videoFilePath);

  const confirmExit = async () => {
    await cleanupFile();
    setShowConfirmExit(false);
    onClose();
  };

  const handleRetry = async () => {
    await cleanupFile();
    onRetry();
  };

  return (
    <>
      <Dialog open={open} onOpenChange={() => setShowConfirmExit(true)}>
        <DialogContent className="max-w-4xl">
          <DialogHeader className="flex flex-row items-center justify-between">
            <DialogTitle className="text-xl">Recording Preview</DialogTitle>
          </DialogHeader>

          {videoUrl && (
            <VideoPlayer
              videoUrl={videoUrl}
              videoBlob={videoBlob}
              onDurationLoad={onDurationLoad}
            />
          )}

          {audioCheck.status === "checking" && (
            <p className="text-sm text-muted-foreground">Checking audio…</p>
          )}
          {audioCheck.status === "no_audio" && (
            <div className="rounded-md border border-ssw-red/30 bg-ssw-red/10 px-3 py-2 text-sm text-ssw-red-foreground">
              No audio detected in this recording. Please re-record and make sure the correct
              microphone is selected and unmuted.
            </div>
          )}
          {audioCheck.status === "error" && (
            <p className="text-sm text-muted-foreground">
              Couldn&apos;t verify audio: {audioCheck.error}
            </p>
          )}

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={handleRetry}>
              <RotateCcw className="w-4 h-4" />
              Re-record
            </Button>
            <Button
              variant="default"
              onClick={onContinue}
              disabled={audioCheck.status === "checking" || audioCheck.status === "no_audio"}
            >
              <ArrowRight className="w-4 h-4" />
              Continue
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={showConfirmExit} onOpenChange={setShowConfirmExit}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm Exit</AlertDialogTitle>
            <AlertDialogDescription>
              Exiting will discard this recording. Are you sure you want to continue?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmExit}
              className="bg-ssw-red text-ssw-red-foreground hover:bg-ssw-red/90"
            >
              Confirm Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
