import { useCallback, useEffect, useMemo, useState } from "react";
import type { CustomPrompt } from "@/types";
import { usePromptManager } from "../../../hooks/usePromptManager";
import { SearchBar } from "../../common/SearchBar";
import { DeleteConfirmDialog } from "../../dialogs/DeleteConfirmDialog";
import { UnsavedChangesDialog } from "../../dialogs/UnsavedChangesDialog";
import { Button } from "../../ui/button";
import { Separator } from "../../ui/separator";
import { PromptForm } from "./PromptForm";
import { PromptListView } from "./PromptListView";
import type { PromptFormValues } from "./schema";
import { TemplateCard } from "./TemplateCard";
import type { ViewMode } from "./types";

interface CustomPromptSettingsPanelProps {
  isActive: boolean;
  registerLeaveHandler?: (handler: (() => Promise<boolean>) | null) => void;
}

const promptToFormValues = (p: CustomPrompt) => ({
  name: p.name ?? "",
  description: p.description ?? "",
  content: p.content ?? "",
  selectedMcpServerIds: p.selectedMcpServerIds,
});

export function CustomPromptSettingsPanel({
  isActive,
  registerLeaveHandler,
}: CustomPromptSettingsPanelProps) {
  const promptManager = usePromptManager();

  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [editingPrompt, setEditingPrompt] = useState<CustomPrompt | null>(null);
  const [viewingTemplate, setViewingTemplate] = useState<CustomPrompt | null>(null);
  const [templatePrefillContent, setTemplatePrefillContent] = useState<string | undefined>();
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [promptToDelete, setPromptToDelete] = useState<CustomPrompt | null>(null);
  const [unsavedChangesDialogOpen, setUnsavedChangesDialogOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);
  const [pendingLeaveResolver, setPendingLeaveResolver] = useState<
    ((result: boolean) => void) | null
  >(null);
  const [isFormDirty, setIsFormDirty] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const filteredPrompts = useMemo(() => {
    if (!searchQuery.trim()) return promptManager.prompts;
    const query = searchQuery.toLowerCase();
    return promptManager.prompts.filter(
      (p) => p.name.toLowerCase().includes(query) || p.description?.toLowerCase().includes(query),
    );
  }, [promptManager.prompts, searchQuery]);

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
      setViewingTemplate(null);
      setTemplatePrefillContent(undefined);
      setIsFormDirty(false);
    }
  }, [isActive]);

  const hasUnsavedChanges = useCallback(() => {
    return viewMode !== "list" && isFormDirty;
  }, [viewMode, isFormDirty]);

  const handleDirtyChange = useCallback((dirty: boolean) => {
    setIsFormDirty(dirty);
  }, []);

  const handleCreateNew = useCallback(() => {
    if (hasUnsavedChanges()) {
      setPendingAction(() => () => {
        setEditingPrompt(null);
        setTemplatePrefillContent(undefined);
        setViewMode("create");
      });
      setUnsavedChangesDialogOpen(true);
      return;
    }
    setEditingPrompt(null);
    setTemplatePrefillContent(undefined);
    setViewMode("create");
  }, [hasUnsavedChanges]);

  const handleViewTemplate = useCallback(
    (template: CustomPrompt) => {
      if (hasUnsavedChanges()) {
        setPendingAction(() => () => {
          setViewingTemplate(template);
          setEditingPrompt(null);
          setViewMode("view-template");
        });
        setUnsavedChangesDialogOpen(true);
        return;
      }
      setViewingTemplate(template);
      setEditingPrompt(null);
      setViewMode("view-template");
    },
    [hasUnsavedChanges],
  );

  const handleUseTemplate = useCallback(
    (template: CustomPrompt) => {
      if (hasUnsavedChanges()) {
        setPendingAction(() => () => {
          setEditingPrompt(null);
          setViewingTemplate(null);
          setTemplatePrefillContent(template.content);
          setViewMode("create");
        });
        setUnsavedChangesDialogOpen(true);
        return;
      }
      setEditingPrompt(null);
      setViewingTemplate(null);
      setTemplatePrefillContent(template.content);
      setViewMode("create");
    },
    [hasUnsavedChanges],
  );

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
    async (data: PromptFormValues) => {
      const success =
        viewMode === "create"
          ? await promptManager.createPrompt(data)
          : editingPrompt
            ? await promptManager.updatePrompt(editingPrompt.id, data)
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
        setViewingTemplate(null);
        setTemplatePrefillContent(undefined);
      });
      setUnsavedChangesDialogOpen(true);
      return;
    }
    setViewMode("list");
    setEditingPrompt(null);
    setViewingTemplate(null);
    setTemplatePrefillContent(undefined);
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

  const defaultValues = useMemo(() => {
    if (viewingTemplate) {
      return promptToFormValues(viewingTemplate);
    }
    if (editingPrompt) {
      return promptToFormValues(editingPrompt);
    }
    if (templatePrefillContent !== undefined) {
      return {
        name: "",
        description: "",
        content: templatePrefillContent,
        selectedMcpServerIds: [],
      };
    }
    return undefined;
  }, [viewingTemplate, editingPrompt, templatePrefillContent]);

  const renderContent = () => {
    if (viewMode === "list") {
      return (
        <>
          {/* Search + Add row always at the top */}
          <div className="flex items-center gap-2 shrink-0">
            <SearchBar
              value={searchQuery}
              onChange={setSearchQuery}
              placeholder="Search prompts..."
            />
            <Button onClick={handleCreateNew} size="sm" className="shrink-0 cursor-pointer">
              New
            </Button>
          </div>
          <Separator />

          {/* Templates section */}
          {promptManager.templates.length > 0 && (
            <>
              <div className="flex flex-col gap-3 pt-6">
                <h3 className="text-sm font-semibold text-white/70 uppercase tracking-wide">
                  Template
                </h3>
                <div className="flex flex-col gap-3">
                  {promptManager.templates.map((template) => (
                    <TemplateCard
                      key={template.id}
                      template={template}
                      onView={handleViewTemplate}
                      onUseTemplate={handleUseTemplate}
                    />
                  ))}
                </div>
              </div>
              <Separator className="my-4" />
            </>
          )}

          {/* My Prompts section */}
          <div className="flex flex-col gap-3">
            <h3 className="text-sm font-semibold text-white/70 uppercase tracking-wide">
              My Prompts
            </h3>
            <PromptListView
              prompts={filteredPrompts}
              onEdit={handleEdit}
              emptyMessage={
                searchQuery.trim()
                  ? "No prompts found matching your search"
                  : "No prompts yet. Create your first prompt."
              }
            />
          </div>
        </>
      );
    }

    if (viewMode === "view-template" && viewingTemplate) {
      return (
        <PromptForm
          key="view-template"
          defaultValues={defaultValues}
          onCancel={handleBackToList}
          onUseTemplate={() => handleUseTemplate(viewingTemplate)}
          loading={false}
          isTemplate={true}
          onDirtyChange={handleDirtyChange}
        />
      );
    }

    return (
      <PromptForm
        key={viewMode === "create" ? "create" : `edit-${editingPrompt?.id}`}
        defaultValues={defaultValues}
        onSubmit={handleFormSubmit}
        onCancel={handleBackToList}
        onDelete={editingPrompt && !editingPrompt.isTemplate ? handleDelete : undefined}
        loading={promptManager.loading}
        isNewPrompt={viewMode === "create"}
        selectAllServersForNewPrompt={viewMode === "create" && templatePrefillContent !== undefined}
        templateContent={promptManager.templates[0]?.content}
        onDirtyChange={handleDirtyChange}
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
          setViewingTemplate(null);
          setTemplatePrefillContent(undefined);
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
        {viewMode === "list" && (
          <header className="flex flex-col gap-1">
            <h2 className="text-xl font-semibold">Custom Prompt Manager</h2>
            <p className="text-muted-foreground text-sm">
              Manage your custom prompts. Use a template to get started quickly, or create your own
              prompt.
            </p>
          </header>
        )}
        <div className="flex-1">
          <div className="w-full overflow-x-hidden">{renderContent()}</div>
        </div>
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
