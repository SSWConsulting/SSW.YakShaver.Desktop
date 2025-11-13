import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CustomPrompt } from "@/types";
import { usePromptManager } from "../../../hooks/usePromptManager";
import { DeleteConfirmDialog } from "../../dialogs/DeleteConfirmDialog";
import { UnsavedChangesDialog } from "../../dialogs/UnsavedChangesDialog";
import { ScrollArea } from "../../ui/scroll-area";
import { PromptForm, type PromptFormRef } from "./PromptForm";
import { PromptListView } from "./PromptListView";
import type { PromptFormValues } from "./schema";
import type { ViewMode } from "./types";

interface CustomPromptSettingsPanelProps {
  isActive: boolean;
  registerLeaveHandler?: (handler: (() => Promise<boolean>) | null) => void;
}

export function CustomPromptSettingsPanel({
  isActive,
  registerLeaveHandler,
}: CustomPromptSettingsPanelProps) {
  const promptManager = usePromptManager();

  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [editingPrompt, setEditingPrompt] = useState<CustomPrompt | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [promptToDelete, setPromptToDelete] = useState<CustomPrompt | null>(null);
  const [unsavedChangesDialogOpen, setUnsavedChangesDialogOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);
  const [pendingLeaveResolver, setPendingLeaveResolver] = useState<
    ((result: boolean) => void) | null
  >(null);

  const formRef = useRef<PromptFormRef>(null);

  useEffect(() => {
    if (isActive) {
      promptManager.loadPrompts();
      setViewMode("list");
    }
  }, [isActive, promptManager.loadPrompts]);

  useEffect(() => {
    if (!isActive) {
      setViewMode("list");
      setEditingPrompt(null);
    }
  }, [isActive]);

  const hasUnsavedChanges = useCallback(() => {
    return viewMode !== "list" && (formRef.current?.isDirty() ?? false);
  }, [viewMode]);

  const handleCreateNew = useCallback(() => {
    if (hasUnsavedChanges()) {
      setPendingAction(() => () => {
        setEditingPrompt(null);
        setViewMode("create");
      });
      setUnsavedChangesDialogOpen(true);
      return;
    }
    setEditingPrompt(null);
    setViewMode("create");
  }, [hasUnsavedChanges]);

  const handleEdit = useCallback(
    (prompt: CustomPrompt) => {
      if (hasUnsavedChanges()) {
        setPendingAction(() => () => {
          setEditingPrompt(prompt);
          setViewMode("edit");
        });
        setUnsavedChangesDialogOpen(true);
        return;
      }

      setEditingPrompt(prompt);
      setViewMode("edit");
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
    }

    setDeleteDialogOpen(false);
    setPromptToDelete(null);
  }, [promptToDelete, promptManager]);

  const handleBackToList = useCallback(() => {
    if (hasUnsavedChanges()) {
      setPendingAction(() => () => {
        setViewMode("list");
        setEditingPrompt(null);
      });
      setUnsavedChangesDialogOpen(true);
      return;
    }
    setViewMode("list");
    setEditingPrompt(null);
  }, [hasUnsavedChanges]);

  const handleConfirmUnsavedChanges = useCallback(() => {
    setUnsavedChangesDialogOpen(false);
    if (pendingAction) {
      pendingAction();
      setPendingAction(null);
    }
    if (pendingLeaveResolver) {
      pendingLeaveResolver(true);
      setPendingLeaveResolver(null);
    }
  }, [pendingAction, pendingLeaveResolver]);

  const handleCancelUnsavedChanges = useCallback(() => {
    setUnsavedChangesDialogOpen(false);
    setPendingAction(null);
    if (pendingLeaveResolver) {
      pendingLeaveResolver(false);
      setPendingLeaveResolver(null);
    }
  }, [pendingLeaveResolver]);

  const defaultValues = useMemo(
    () =>
      editingPrompt
        ? {
            name: editingPrompt.name,
            description: editingPrompt.description || "",
            content: editingPrompt.content,
          }
        : undefined,
    [editingPrompt],
  );

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
        ref={formRef}
        defaultValues={defaultValues}
        onSubmit={handleFormSubmit}
        onCancel={handleBackToList}
        onDelete={editingPrompt && !editingPrompt.isDefault ? handleDelete : undefined}
        loading={promptManager.loading}
        isDefault={editingPrompt?.isDefault}
      />
    );
  };

  useEffect(() => {
    if (!registerLeaveHandler) return;

    if (!isActive) {
      registerLeaveHandler(null);
      return;
    }

    const handler = async () => {
      if (!hasUnsavedChanges()) {
        return true;
      }

      return await new Promise<boolean>((resolve) => {
        setPendingAction(() => () => {
          setViewMode("list");
          setEditingPrompt(null);
        });
        setPendingLeaveResolver(() => resolve);
        setUnsavedChangesDialogOpen(true);
      });
    };

    registerLeaveHandler(handler);

    return () => {
      registerLeaveHandler(null);
    };
  }, [registerLeaveHandler, isActive, hasUnsavedChanges]);

  return (
    <>
      <div className="flex h-full min-h-0 flex-col gap-4 overflow-hidden">
        <header className="flex flex-col gap-1">
          <h2 className="text-white text-xl font-semibold">Custom Prompt Manager</h2>
          <p className="text-white/70 text-sm">
            Manage your saved prompts and choose which one YakShaver should use.
          </p>
        </header>
        <ScrollArea className="flex-1">
          <div className="h-full min-h-0 pr-3">{renderContent()}</div>
        </ScrollArea>
      </div>

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
          promptToDelete?.name
            ? `Are you sure you want to delete the prompt "${promptToDelete.name}"?`
            : undefined
        }
      />
    </>
  );
}
