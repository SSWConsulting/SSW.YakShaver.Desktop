import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { buttonVariants } from "../ui/button";

interface DeleteConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  deleteTitle?: string;
  deleteConfirmMessage?: string;
  /** Label for the confirm button (e.g. "Clear Token"). Defaults to "Delete". */
  confirmLabel?: string;
}

export function DeleteConfirmDialog({
  open,
  onOpenChange,
  onConfirm,
  deleteTitle = "Delete Item",
  deleteConfirmMessage = "Are you sure you want to delete this item?",
  confirmLabel = "Delete",
}: DeleteConfirmDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{deleteTitle}</AlertDialogTitle>
          <AlertDialogDescription>{deleteConfirmMessage}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel className="cursor-pointer">Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            className={buttonVariants({
              variant: "destructiveOutline",
              className: "cursor-pointer",
            })}
          >
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
