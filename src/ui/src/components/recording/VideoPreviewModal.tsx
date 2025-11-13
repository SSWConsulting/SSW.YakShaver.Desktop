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
        <DialogContent className="max-w-4xl bg-black/90 backdrop-blur-md border-white/20">
          <DialogHeader className="flex flex-row items-center justify-between">
            <DialogTitle className="text-white text-xl">Recording Preview</DialogTitle>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setShowConfirmExit(true)}
              className="text-white/60 hover:text-white hover:bg-white/10"
            >
              <X className="size-4" />
            </Button>
          </DialogHeader>

          {videoUrl && <VideoPlayer videoUrl={videoUrl} videoBlob={videoBlob} />}

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={handleRetry}
              className="gap-2 bg-white/10 text-white border-white/20 hover:bg-white/15 hover:text-white transition-colors"
            >
              <RotateCcw className="w-4 h-4" />
              Re-record
            </Button>
            <Button
              variant="default"
              onClick={onContinue}
              className="gap-2 bg-white text-black hover:bg-white/90 hover:text-black transition-colors"
            >
              <ArrowRight className="w-4 h-4" />
              Continue
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={showConfirmExit} onOpenChange={setShowConfirmExit}>
        <AlertDialogContent className="bg-black/90 backdrop-blur-md border-white/20">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-white">Confirm Exit</AlertDialogTitle>
            <AlertDialogDescription className="text-white/70">
              Exiting will discard this recording. Are you sure you want to continue?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="bg-white/10 text-white hover:bg-white/20 border-white/20">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmExit}
              className="bg-red-600 text-white hover:bg-red-700"
            >
              Confirm Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
