import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { ipcClient } from "../../services/ipc-client";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "../ui/dialog";
import { Textarea } from "../ui/textarea";

export function CustomPromptDialog() {
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  const loadPrompt = useCallback(async () => {
    try {
      setPrompt(await ipcClient.settings.getCustomPrompt());
      setHasChanges(false);
    } catch (e) {
      toast.error(`Failed to load: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, []);

  useEffect(() => {
    if (open) loadPrompt();
  }, [open, loadPrompt]);

  async function handleSave() {
    setLoading(true);
    try {
      await ipcClient.settings.setCustomPrompt(prompt);
      toast.success("Custom prompt saved successfully");
      setHasChanges(false);
    } catch (e) {
      toast.error(`Failed to save: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoading(false);
    }
  }

  function handleChange(value: string) {
    setPrompt(value);
    setHasChanges(true);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary">Custom Prompt</Button>
      </DialogTrigger>
      <DialogContent
        showCloseButton
        className="max-w-4xl max-h-[90vh] overflow-y-auto bg-neutral-900 text-neutral-100 border-neutral-800"
      >
        <DialogHeader>
          <DialogTitle className="text-white text-2xl">Custom Prompt Settings</DialogTitle>
          <DialogDescription className="text-white/70 text-base">
            Add your custom instructions that will be appended to the task execution prompt. This
            allows you to customize how the AI agent behaves when executing tasks.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-6 mt-4">
          <div className="flex flex-col gap-3">
            <Textarea
              value={prompt}
              onChange={(e) => handleChange(e.target.value)}
              placeholder="Enter your custom instructions here..."
              aria-label="Custom Instructions"
              className="min-h-[300px] bg-black/30 border-white/20 text-white placeholder:text-white/40 focus:border-white/40 font-mono text-sm"
            />
            <p className="text-white/50 text-xs">
              Your custom prompt will be injected into the task execution system prompt.
            </p>
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-white/10">
            <Button
              variant="outline"
              onClick={() => setOpen(false)}
              className="bg-neutral-800 text-white border-neutral-700 hover:bg-neutral-700"
            >
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={loading || !hasChanges}
              className="bg-white text-black hover:bg-gray-100"
            >
              {loading ? "Saving..." : "Save"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
