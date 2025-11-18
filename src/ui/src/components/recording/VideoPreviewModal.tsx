import { ArrowRight, RotateCcw, X } from "lucide-react";
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
}

export function VideoPreviewModal({
  open,
  videoBlob,
  videoFilePath,
  onClose,
  onRetry,
  onContinue,
}: VideoPreviewModalProps) {
  const [videoUrl, setVideoUrl] = useState("");
  const [showConfirmExit, setShowConfirmExit] = useState(false);

  useEffect(() => {
    if (!videoBlob) return;
    const url = URL.createObjectURL(videoBlob);
    setVideoUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [videoBlob]);

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

          {videoUrl && <VideoPlayer videoUrl={videoUrl} videoBlob={videoBlob} />}

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={handleRetry}>
              <RotateCcw className="w-4 h-4" />
              Re-record
            </Button>
            <Button variant="default" onClick={onContinue}>
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
