import { useCallback, useEffect, useId, useState } from "react";
import { toast } from "sonner";
import type { CustomPrompt } from "@/types";
import { ipcClient } from "../../services/ipc-client";
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
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Separator } from "../ui/separator";
import { Textarea } from "../ui/textarea";
import { ScrollArea } from "../ui/scroll-area";
import clsx from "clsx";
import { Label } from "../ui/label";

type ViewMode = "list" | "edit" | "create";

export function CustomPromptManager() {
  const nameInputId = useId();
  const contentInputId = useId();
  const [prompts, setPrompts] = useState<CustomPrompt[]>([]);
  const [activePromptId, setActivePromptId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [editingPrompt, setEditingPrompt] = useState<CustomPrompt | null>(null);
  const [formName, setFormName] = useState("");
  const [formContent, setFormContent] = useState("");
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [promptToDelete, setPromptToDelete] = useState<CustomPrompt | null>(null);

  const loadPrompts = useCallback(async () => {
    try {
      const [allPrompts, activePrompt] = await Promise.all([
        ipcClient.settings.getAllPrompts(),
        ipcClient.settings.getActivePrompt(),
      ]);
      setPrompts(allPrompts);
      setActivePromptId(activePrompt?.id || null);
    } catch (e) {
      toast.error(`Failed to load prompts: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, []);

  useEffect(() => {
    if (open) {
      loadPrompts();
      setViewMode("list");
    }
  }, [open, loadPrompts]);

  const handleCreateNew = () => {
    setFormName("");
    setFormContent("");
    setEditingPrompt(null);
    setViewMode("create");
  };

  const handleEdit = (prompt: CustomPrompt) => {
    setFormName(prompt.name);
    setFormContent(prompt.content);
    setEditingPrompt(prompt);
    setViewMode("edit");
  };

  const handleSave = async () => {
    if (!formName.trim()) {
      toast.error("Please enter a prompt name");
      return;
    }

    setLoading(true);
    try {
      if (viewMode === "create") {
        await ipcClient.settings.addPrompt({ name: formName, content: formContent });
        toast.success("Prompt created successfully");
      } else if (editingPrompt) {
        await ipcClient.settings.updatePrompt(editingPrompt.id, {
          name: formName,
          content: formContent,
        });
        toast.success("Prompt updated successfully");
      }
      await loadPrompts();
      setViewMode("list");
    } catch (e) {
      toast.error(`Failed to save: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = (prompt: CustomPrompt) => {
    setPromptToDelete(prompt);
    setDeleteDialogOpen(true);
  };

  const confirmDelete = async () => {
    if (!promptToDelete) return;

    setLoading(true);
    try {
      const success = await ipcClient.settings.deletePrompt(promptToDelete.id);
      if (success) {
        toast.success("Prompt deleted successfully");
        await loadPrompts();
        setViewMode("list");
      } else {
        toast.error("Cannot delete default prompt");
      }
    } catch (e) {
      toast.error(`Failed to delete: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoading(false);
      setDeleteDialogOpen(false);
      setPromptToDelete(null);
    }
  };

  const handleSetActive = async (promptId: string) => {
    setLoading(true);
    try {
      await ipcClient.settings.setActivePrompt(promptId);
      toast.success("Active prompt updated");
      await loadPrompts();
    } catch (e) {
      toast.error(`Failed to set active: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoading(false);
    }
  };

  const renderListView = () => (
    <div className="flex flex-col gap-4 h-full overflow-hidden">
      <div className="flex justify-end shrink-0">
        <Button onClick={handleCreateNew} variant="secondary" size="sm">
          Add New Prompt
        </Button>
      </div>
      <Separator className="bg-white/10 shrink-0" />
      <ScrollArea className="h-[50vh]">
        <div className="flex flex-col space-y-4 pr-4">
          {prompts.map((prompt) => (
            <Card
              key={prompt.id}
              className={clsx(
                `p-4 bg-black/30 border transition-colors ${
                  prompt.id === activePromptId
                    ? "border-white/40 bg-white/5"
                    : "border-white/20 hover:border-white/30"
                }`,
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-2">
                    <h3 className="text-white font-medium truncate">{prompt.name}</h3>
                    {prompt.isDefault && (
                      <Badge variant="secondary" className="text-xs">
                        Default
                      </Badge>
                    )}
                    {prompt.id === activePromptId && (
                      <Badge className="text-xs bg-green-600 hover:bg-green-700">Active</Badge>
                    )}
                  </div>
                  <p className="text-white/50 text-sm line-clamp-2">
                    {prompt.content || "No content"}
                  </p>
                </div>

                <div className="flex gap-2 shrink-0">
                  {prompt.id !== activePromptId && (
                    <Button
                      onClick={() => handleSetActive(prompt.id)}
                      variant="outline"
                      size="sm"
                      className="bg-neutral-800 text-white border-neutral-700 hover:bg-neutral-700"
                    >
                      Use
                    </Button>
                  )}
                  <Button
                    onClick={() => handleEdit(prompt)}
                    variant="outline"
                    size="sm"
                    className="bg-neutral-800 text-white border-neutral-700 hover:bg-neutral-700"
                  >
                    Edit
                  </Button>
                  {!prompt.isDefault && (
                    <Button
                      onClick={() => handleDelete(prompt)}
                      variant="outline"
                      size="sm"
                      className="bg-red-900/20 text-red-400 border-red-700 hover:bg-red-900/40"
                    >
                      Delete
                    </Button>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      </ScrollArea>
    </div>
  );

  const renderFormView = () => (
    <div className="flex flex-col gap-4 h-full overflow-hidden">
      <Button onClick={() => setViewMode("list")} variant="ghost" className="self-start shrink-0">
        ← Back to list
      </Button>

      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor={nameInputId} className="text-white text-sm font-medium">
            Prompt Name *
          </Label>
          <Input
            id={nameInputId}
            value={formName}
            onChange={(e) => setFormName(e.target.value)}
            placeholder="e.g., Documentation Writer, Code Reviewer"
            disabled={editingPrompt?.isDefault}
          />
          {editingPrompt?.isDefault && (
            <p className="text-white/50 text-xs">Default prompt name cannot be changed</p>
          )}
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor={contentInputId} className="text-white text-sm font-medium">
            Prompt Instructions
          </Label>
          <Textarea
            id={contentInputId}
            value={formContent}
            onChange={(e) => setFormContent(e.target.value)}
            placeholder="Enter your custom instructions here..."
            className="resize-none h-80 font-mono text-sm"
          />
          <p className="text-white/50 text-xs">
            These instructions will be appended to the task execution system prompt
          </p>
        </div>

        <div className="flex justify-end gap-3 pt-4 border-t border-white/10">
          <Button
            variant="outline"
            onClick={() => setViewMode("list")}
            className="bg-neutral-800 text-white border-neutral-700 hover:bg-neutral-700"
          >
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={loading || !formName.trim()}
            className="bg-white text-black hover:bg-gray-100"
          >
            {loading ? "Saving..." : "Save"}
          </Button>
        </div>
      </div>
    </div>
  );

  return (
    <>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button variant="secondary">Custom Prompts</Button>
        </DialogTrigger>
        <DialogContent
          showCloseButton
          className="flex flex-col max-w-4xl max-h-[90vh] bg-neutral-900 text-neutral-100 border-neutral-800"
        >
          <DialogHeader className="shrink-0">
            <DialogTitle className="text-white text-2xl">
              {viewMode === "list"
                ? "Custom Prompt Manager"
                : viewMode === "create"
                  ? "Create New Prompt"
                  : "Edit Prompt"}
            </DialogTitle>
            <DialogDescription className="text-white/70 text-base">
              {viewMode === "list"
                ? "Manage your custom prompts and select which one to use for task execution"
                : "Configure your custom instructions for the AI agent"}
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 min-h-0">
            {viewMode === "list" ? renderListView() : renderFormView()}
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent className="bg-neutral-900 text-neutral-100 border-neutral-800">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-white">Delete Prompt</AlertDialogTitle>
            <AlertDialogDescription className="text-white/70">
              Are you sure you want to delete "{promptToDelete?.name}"? This action cannot be
              undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="bg-neutral-800 text-white border-neutral-700 hover:bg-neutral-700">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              className="bg-red-600 text-white hover:bg-red-700"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
