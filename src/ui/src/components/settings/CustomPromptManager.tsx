import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
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
import type { PromptFormData, ViewMode } from "./custom-prompt/types";

export function CustomPromptManager() {
  // Use custom hook for prompt management
  const promptManager = usePromptManager();

  // UI State
  const [open, setOpen] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("list");

  // Form State
  const [editingPrompt, setEditingPrompt] = useState<CustomPrompt | null>(null);
  const [formData, setFormData] = useState<PromptFormData>({
    name: "",
    description: "",
    content: "",
  });

  // Dialog State
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [promptToDelete, setPromptToDelete] = useState<CustomPrompt | null>(null);
  const [unsavedChangesDialogOpen, setUnsavedChangesDialogOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);

  // Load prompts when dialog opens
  useEffect(() => {
    if (open) {
      promptManager.loadPrompts();
      setViewMode("list");
    }
  }, [open, promptManager.loadPrompts]);

  // Helper: Check for unsaved changes
  const hasUnsavedChanges = useCallback(() => {
    if (viewMode === "list") return false;

    if (viewMode === "create") {
      return (
        formData.name.trim() !== "" ||
        formData.description.trim() !== "" ||
        formData.content.trim() !== ""
      );
    }

    if (editingPrompt) {
      return (
        formData.name !== editingPrompt.name ||
        formData.description !== (editingPrompt.description || "") ||
        formData.content !== editingPrompt.content
      );
    }

    return false;
  }, [viewMode, formData, editingPrompt]);

  // Helper: Reset form
  const resetForm = useCallback(() => {
    setFormData({ name: "", description: "", content: "" });
    setEditingPrompt(null);
  }, []);

  // Helper: Load form with prompt data
  const loadFormData = useCallback((prompt: CustomPrompt) => {
    setFormData({
      name: prompt.name,
      description: prompt.description || "",
      content: prompt.content,
    });
    setEditingPrompt(prompt);
  }, []);

  // Handler: Create new prompt
  const handleCreateNew = useCallback(() => {
    resetForm();
    setViewMode("create");
  }, [resetForm]);

  // Handler: Edit prompt
  const handleEdit = useCallback(
    (prompt: CustomPrompt) => {
      if (hasUnsavedChanges()) {
        setPendingAction(() => () => {
          loadFormData(prompt);
          setViewMode("edit");
        });
        setUnsavedChangesDialogOpen(true);
        return;
      }

      loadFormData(prompt);
      setViewMode("edit");
    },
    [hasUnsavedChanges, loadFormData],
  );

  // Handler: Save prompt
  const handleSave = useCallback(
    async (andActivate: boolean) => {
      if (!formData.name.trim()) {
        toast.error("Please enter a prompt name");
        return;
      }

      const success =
        viewMode === "create"
          ? await promptManager.createPrompt(formData, andActivate)
          : editingPrompt
            ? await promptManager.updatePrompt(editingPrompt.id, formData, andActivate)
            : false;

      if (success) {
        setViewMode("list");
        resetForm();
      }
    },
    [viewMode, formData, editingPrompt, promptManager, resetForm],
  );

  // Handler: Delete prompt
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
      resetForm();
    }

    setDeleteDialogOpen(false);
    setPromptToDelete(null);
  }, [promptToDelete, promptManager, resetForm]);

  // Handler: Back to list
  const handleBackToList = useCallback(() => {
    if (hasUnsavedChanges()) {
      setPendingAction(() => () => {
        setViewMode("list");
        resetForm();
      });
      setUnsavedChangesDialogOpen(true);
      return;
    }
    setViewMode("list");
    resetForm();
  }, [hasUnsavedChanges, resetForm]);

  // Handler: Dialog close
  const handleDialogClose = useCallback(
    (isOpen: boolean) => {
      if (!isOpen && hasUnsavedChanges()) {
        setPendingAction(() => () => {
          setOpen(false);
          setViewMode("list");
          resetForm();
        });
        setUnsavedChangesDialogOpen(true);
        return;
      }
      setOpen(isOpen);
      if (!isOpen) {
        setViewMode("list");
        resetForm();
      }
    },
    [hasUnsavedChanges, resetForm],
  );

  // Handler: Confirm unsaved changes
  const handleConfirmUnsavedChanges = useCallback(() => {
    setUnsavedChangesDialogOpen(false);
    if (pendingAction) {
      pendingAction();
      setPendingAction(null);
    }
  }, [pendingAction]);

  // Handler: Cancel unsaved changes
  const handleCancelUnsavedChanges = useCallback(() => {
    setUnsavedChangesDialogOpen(false);
    setPendingAction(null);
  }, []);

  // Render views based on mode
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

    return (
      <PromptForm
        formData={formData}
        onChange={(data) => setFormData((prev) => ({ ...prev, ...data }))}
        onSave={handleSave}
        onCancel={handleBackToList}
        onDelete={editingPrompt && !editingPrompt.isDefault ? handleDelete : undefined}
        loading={promptManager.loading}
        isDefault={editingPrompt?.isDefault}
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
