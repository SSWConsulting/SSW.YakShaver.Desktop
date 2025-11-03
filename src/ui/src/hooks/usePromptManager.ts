import { useCallback, useState } from "react";
import { toast } from "sonner";
import type { CustomPrompt } from "@/types";
import type { PromptFormData } from "../components/settings/custom-prompt/types";
import { ipcClient } from "../services/ipc-client";

export function usePromptManager() {
  const [prompts, setPrompts] = useState<CustomPrompt[]>([]);
  const [activePromptId, setActivePromptId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

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

  const createPrompt = async (data: PromptFormData, andActivate: boolean) => {
    setLoading(true);
    try {
      const newPrompt = await ipcClient.settings.addPrompt({
        name: data.name,
        description: data.description,
        content: data.content,
      });
      toast.success("Prompt created successfully");

      if (andActivate) {
        await ipcClient.settings.setActivePrompt(newPrompt.id);
        toast.success("Prompt saved and activated");
      }

      await loadPrompts();
      return true;
    } catch (e) {
      toast.error(`Failed to save: ${e instanceof Error ? e.message : String(e)}`);
      return false;
    } finally {
      setLoading(false);
    }
  };

  const updatePrompt = async (id: string, data: PromptFormData, andActivate: boolean) => {
    setLoading(true);
    try {
      await ipcClient.settings.updatePrompt(id, {
        name: data.name,
        description: data.description,
        content: data.content,
      });
      if (andActivate) {
        await ipcClient.settings.setActivePrompt(id);
      }
      toast.success(andActivate ? "Prompt updated and activated" : "Prompt updated successfully");

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

  const setActivePrompt = async (promptId: string) => {
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

  return {
    prompts,
    activePromptId,
    loading,
    loadPrompts,
    createPrompt,
    updatePrompt,
    deletePrompt,
    setActivePrompt,
  };
}
