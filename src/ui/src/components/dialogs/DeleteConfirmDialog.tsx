import { Trash2 } from "lucide-react";
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

interface DeleteConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  deleteTitle?: string;
  deleteConfirmMessage?: string;
}

export function DeleteConfirmDialog({
  open,
  onOpenChange,
  onConfirm,
  deleteTitle = "Delete Item",
  deleteConfirmMessage = "Are you sure you want to delete this item?",
}: DeleteConfirmDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="bg-neutral-900 text-neutral-100 border-neutral-800">
        <AlertDialogHeader>
          <AlertDialogTitle className="text-white">{deleteTitle}</AlertDialogTitle>
          <AlertDialogDescription className="text-white/70">
            {deleteConfirmMessage}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel className="text-black cursor-pointer">Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            className="bg-red-600 hover:bg-red-700 cursor-pointer"
          >
            <Trash2 className="w-4 h-4" />
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
