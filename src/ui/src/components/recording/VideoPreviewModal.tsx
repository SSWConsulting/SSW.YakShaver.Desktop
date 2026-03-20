import type { ToolApprovalMode } from "@shared/types/user-settings";
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
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { VideoPlayer } from "./VideoPlayer";

interface VideoPreviewModalProps {
  open: boolean;
  videoBlob: Blob;
  videoFilePath: string;
  approvalMode: ToolApprovalMode;
  onClose: () => void;
  onRetry: () => void;
  onContinue: (shaveAutoApprove: boolean) => void;
  onDurationLoad?: (duration: number) => void;
}

export function VideoPreviewModal({
  open,
  videoBlob,
  videoFilePath,
  approvalMode,
  onClose,
  onRetry,
  onContinue,
  onDurationLoad,
}: VideoPreviewModalProps) {
  const [videoUrl, setVideoUrl] = useState("");
  const [showConfirmExit, setShowConfirmExit] = useState(false);
  const [autoApproveChecked, setAutoApproveChecked] = useState(false);
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
      setAutoApproveChecked(false);
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

          <DialogFooter className="flex-col items-start gap-3 sm:flex-col">
            {approvalMode !== "yolo" && (
              <div className="flex items-center gap-2">
                <Checkbox
                  id="auto-approve"
                  checked={autoApproveChecked}
                  onCheckedChange={(checked) => setAutoApproveChecked(checked === true)}
                />
                <Label htmlFor="auto-approve" className="text-sm font-normal text-muted-foreground">
                  Auto-approve all confirmations
                </Label>
              </div>
            )}
            <div className="flex w-full justify-end gap-2">
              <Button variant="outline" onClick={handleRetry}>
                <RotateCcw className="w-4 h-4" />
                Re-record
              </Button>
              <Button
                variant="default"
                onClick={() => onContinue(autoApproveChecked)}
                disabled={audioCheck.status === "checking" || audioCheck.status === "no_audio"}
              >
                <ArrowRight className="w-4 h-4" />
                Shave it
              </Button>
            </div>
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
