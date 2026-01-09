import { ipcClient } from "../../services/ipc-client";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";

type MacScreenRecordingPermissionDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function MacScreenRecordingPermissionDialog({ open, onOpenChange }: MacScreenRecordingPermissionDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Permission Required</DialogTitle>
          <DialogDescription>
            YakShaver needs permission to record your screen.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={async () => {
              try {
                await ipcClient.app.openExternal(
                  "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
                );
              } finally {
                onOpenChange(false);
              }
            }}
          >
            Open System Settings
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
