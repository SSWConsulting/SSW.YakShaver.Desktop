import { useCallback, useEffect, useRef, useState } from "react";
import type { CustomPrompt } from "@/types";
import { usePromptManager } from "../../hooks/usePromptManager";
import { DeleteConfirmDialog } from "../dialogs/DeleteConfirmDialog";
import { UnsavedChangesDialog } from "../dialogs/UnsavedChangesDialog";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "../ui/dialog";
import { PromptForm } from "./custom-prompt/PromptForm";
import { PromptListView } from "./custom-prompt/PromptListView";
import type { PromptFormValues } from "./custom-prompt/schema";
import type { ViewMode } from "./custom-prompt/types";

export function CustomPromptManager() {
  const promptManager = usePromptManager();

  const [open, setOpen] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [editingPrompt, setEditingPrompt] = useState<CustomPrompt | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [promptToDelete, setPromptToDelete] = useState<CustomPrompt | null>(null);
  const [unsavedChangesDialogOpen, setUnsavedChangesDialogOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);

  const formIsDirtyRef = useRef(false);

  useEffect(() => {
    if (open) {
      promptManager.loadPrompts();
      setViewMode("list");
    }
  }, [open, promptManager.loadPrompts]);

  const hasUnsavedChanges = useCallback(() => {
    return viewMode !== "list" && formIsDirtyRef.current;
  }, [viewMode]);

  const handleCreateNew = useCallback(() => {
    if (hasUnsavedChanges()) {
      setPendingAction(() => () => {
        setEditingPrompt(null);
        setViewMode("create");
        formIsDirtyRef.current = false;
      });
      setUnsavedChangesDialogOpen(true);
      return;
    }
    setEditingPrompt(null);
    setViewMode("create");
    formIsDirtyRef.current = false;
  }, [hasUnsavedChanges]);

  const handleEdit = useCallback(
    (prompt: CustomPrompt) => {
      if (hasUnsavedChanges()) {
        setPendingAction(() => () => {
          setEditingPrompt(prompt);
          setViewMode("edit");
          formIsDirtyRef.current = false;
        });
        setUnsavedChangesDialogOpen(true);
        return;
      }

      setEditingPrompt(prompt);
      setViewMode("edit");
      formIsDirtyRef.current = false;
    },
    [hasUnsavedChanges],
  );

  const handleFormSubmit = useCallback(
    async (data: PromptFormValues, andActivate: boolean) => {
      const success =
        viewMode === "create"
          ? await promptManager.createPrompt(data, andActivate)
          : editingPrompt
            ? await promptManager.updatePrompt(editingPrompt.id, data, andActivate)
            : false;

      if (success) {
        setViewMode("list");
        setEditingPrompt(null);
        formIsDirtyRef.current = false;
      }
    },
    [viewMode, editingPrompt, promptManager],
  );

  const handleDelete = useCallback(() => {
    if (editingPrompt) {
      setPromptToDelete(editingPrompt);
      setDeleteDialogOpen(true);
    }
  }, [editingPrompt]);

  const confirmDelete = useCallback(async () => {
    if (!promptToDelete) return;

    const success = await promptManager.deletePrompt(promptToDelete.id);
    if (success) {
      setViewMode("list");
      setEditingPrompt(null);
      formIsDirtyRef.current = false;
    }

    setDeleteDialogOpen(false);
    setPromptToDelete(null);
  }, [promptToDelete, promptManager]);

  const handleBackToList = useCallback(() => {
    if (hasUnsavedChanges()) {
      setPendingAction(() => () => {
        setViewMode("list");
        setEditingPrompt(null);
        formIsDirtyRef.current = false;
      });
      setUnsavedChangesDialogOpen(true);
      return;
    }
    setViewMode("list");
    setEditingPrompt(null);
    formIsDirtyRef.current = false;
  }, [hasUnsavedChanges]);

  const handleDialogClose = useCallback(
    (isOpen: boolean) => {
      if (!isOpen && hasUnsavedChanges()) {
        setPendingAction(() => () => {
          setOpen(false);
          setViewMode("list");
          setEditingPrompt(null);
          formIsDirtyRef.current = false;
        });
        setUnsavedChangesDialogOpen(true);
        return;
      }
      setOpen(isOpen);
      if (!isOpen) {
        setViewMode("list");
        setEditingPrompt(null);
        formIsDirtyRef.current = false;
      }
    },
    [hasUnsavedChanges],
  );

  const handleConfirmUnsavedChanges = useCallback(() => {
    setUnsavedChangesDialogOpen(false);
    if (pendingAction) {
      pendingAction();
      setPendingAction(null);
    }
  }, [pendingAction]);

  const handleCancelUnsavedChanges = useCallback(() => {
    setUnsavedChangesDialogOpen(false);
    setPendingAction(null);
  }, []);

  const renderContent = () => {
    if (viewMode === "list") {
      return (
        <PromptListView
          prompts={promptManager.prompts}
          activePromptId={promptManager.activePromptId}
          onCreateNew={handleCreateNew}
          onEdit={handleEdit}
          onSetActive={promptManager.setActivePrompt}
        />
      );
    }

    const defaultValues = editingPrompt
      ? {
          name: editingPrompt.name,
          description: editingPrompt.description || "",
          content: editingPrompt.content,
        }
      : undefined;

    return (
      <PromptForm
        defaultValues={defaultValues}
        onSubmit={handleFormSubmit}
        onCancel={handleBackToList}
        onDelete={editingPrompt && !editingPrompt.isDefault ? handleDelete : undefined}
        loading={promptManager.loading}
        isDefault={editingPrompt?.isDefault}
        onFormStateChange={(isDirty) => {
          formIsDirtyRef.current = isDirty;
        }}
      />
    );
  };

  return (
    <>
      <Dialog open={open} onOpenChange={handleDialogClose}>
        <DialogTrigger asChild>
          <Button variant="secondary">Custom Prompts</Button>
        </DialogTrigger>
        <DialogContent
          showCloseButton
          className="flex flex-col max-w-4xl max-h-[90vh] bg-neutral-900 text-neutral-100 border-neutral-800"
        >
          <DialogHeader className="shrink-0">
            <DialogTitle className="text-white text-xl">
              {viewMode === "list"
                ? "Custom Prompt Manager"
                : viewMode === "create"
                  ? "Create New Prompt"
                  : "Edit Prompt"}
            </DialogTitle>
            <DialogDescription className="text-white/80 text-sm">
              {viewMode === "list"
                ? "Manage your custom prompts and select which one to use for task execution"
                : "Configure your custom instructions for the AI agent"}
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 min-h-0">{renderContent()}</div>
        </DialogContent>
      </Dialog>

      <UnsavedChangesDialog
        open={unsavedChangesDialogOpen}
        onOpenChange={setUnsavedChangesDialogOpen}
        onConfirm={handleConfirmUnsavedChanges}
        onCancel={handleCancelUnsavedChanges}
      />

      <DeleteConfirmDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        onConfirm={confirmDelete}
        deleteTitle="Delete Prompt"
        deleteConfirmMessage={
          promptToDelete?.name &&
          `Are you sure you want to delete the prompt "${promptToDelete?.name}"?`
        }
      />
    </>
  );
}
