import { useCallback, useState } from "react";
import { toast } from "sonner";
import type { CustomPrompt, PromptFormData } from "@/types";
import { ipcClient } from "../services/ipc-client";

export function usePromptManager() {
  const [prompts, setPrompts] = useState<CustomPrompt[]>([]);
  const [templates, setTemplates] = useState<CustomPrompt[]>([]);
  const [loading, setLoading] = useState(false);

  const loadPrompts = useCallback(async () => {
    try {
      const [allPrompts, allTemplates] = await Promise.all([
        ipcClient.settings.getAllPrompts(),
        ipcClient.settings.getTemplates(),
      ]);
      setPrompts(allPrompts);
      setTemplates(allTemplates);
    } catch (e) {
      toast.error(`Failed to load prompts: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, []);

  const createPrompt = async (data: PromptFormData) => {
    setLoading(true);
    try {
      await ipcClient.settings.addPrompt({
        name: data.name,
        description: data.description,
        content: data.content,
        selectedMcpServerIds: data.selectedMcpServerIds,
      });
      toast.success("Prompt created successfully");
      await loadPrompts();
      return true;
    } catch (e) {
      toast.error(`Failed to save: ${e instanceof Error ? e.message : String(e)}`);
      return false;
    } finally {
      setLoading(false);
    }
  };

  const updatePrompt = async (id: string, data: PromptFormData) => {
    setLoading(true);
    try {
      await ipcClient.settings.updatePrompt(id, {
        name: data.name,
        description: data.description,
        content: data.content,
        selectedMcpServerIds: data.selectedMcpServerIds,
      });
      toast.success("Prompt updated successfully");
      await loadPrompts();
      return true;
    } catch (e) {
      toast.error(`Failed to save: ${e instanceof Error ? e.message : String(e)}`);
      return false;
    } finally {
      setLoading(false);
    }
  };

  const deletePrompt = async (id: string) => {
    setLoading(true);
    try {
      const success = await ipcClient.settings.deletePrompt(id);
      if (success) {
        toast.success("Prompt deleted successfully");
        await loadPrompts();
        return true;
      }
      toast.error("Cannot delete default prompt");
      return false;
    } catch (e) {
      toast.error(`Failed to delete: ${e instanceof Error ? e.message : String(e)}`);
      return false;
    } finally {
      setLoading(false);
    }
  };

  return {
    prompts,
    templates,
    loading,
    loadPrompts,
    createPrompt,
    updatePrompt,
    deletePrompt,
  };
}
