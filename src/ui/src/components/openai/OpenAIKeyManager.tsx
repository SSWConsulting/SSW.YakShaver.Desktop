import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ipcClient } from "../../services/ipc-client";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "../ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import type { LLMConfig } from "../../types";
import { AzureOpenAIProviderForm, OpenAIProviderForm } from "./OpenAIForm";

export function OpenAIKeyManager() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [hasConfig, setHasConfig] = useState(false);
  const [llmForm, setLlmForm] = useState<LLMConfig>({
    provider: "openai",
    apiKey: "",
  });

  async function refreshStatus() {
    try {
      const cfg = await ipcClient.llm.getConfig();
      setHasConfig(!!cfg);
      if (cfg) {
        setLlmForm(cfg);
      } else {
        setLlmForm({ provider: "openai", apiKey: "" });
      }
    } catch (e) {
      console.error(e);
    }
  }

  useEffect(() => {
    void refreshStatus();
  }, []);

  async function onSave() {
    if (llmForm.provider === "openai" && !llmForm.apiKey.trim()) {
      toast.error("Please enter a valid OpenAI API key");
      return;
    }

    if (llmForm.provider === "azure") {
      if (
        !llmForm.apiKey.trim() ||
        !llmForm.endpoint.trim() ||
        !llmForm.version.trim() ||
        !llmForm.deployment.trim()
      ) {
        toast.error("Please fill in all Azure OpenAI fields");
        return;
      }
    }

    try {
      if (llmForm.provider === "openai") {
        await ipcClient.llm.setConfig(llmForm);
        toast.success("OpenAI configuration saved");
      } else {
        await ipcClient.llm.setConfig(llmForm);
        toast.success("Azure OpenAI configuration saved");
      }
      await refreshStatus();
      setDialogOpen(false);
    } catch (e) {
      toast.error("Failed to save configuration");
    }
  }

  async function onClear() {
    try {
      await ipcClient.llm.clearConfig();
      toast.success("LLM configuration cleared");
      await refreshStatus();
    } catch (e) {
      toast.error("Failed to clear configuration");
    }
  }

  return (
    <Dialog
      open={dialogOpen}
      onOpenChange={(open) => {
        setDialogOpen(open);
        if (open) {
          void refreshStatus();
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="secondary">LLM Settings</Button>
      </DialogTrigger>
      <DialogContent className="max-w-md bg-neutral-900 text-neutral-100 border-neutral-800">
        <DialogHeader>
          <DialogTitle className="text-white text-xl">LLM Settings</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <p className="text-white/80 text-sm">
            Status:{" "}
            {hasConfig ? (
              <span className="text-green-400">Configured</span>
            ) : (
              <span className="text-red-400">Not configured</span>
            )}
          </p>
          <div className="flex flex-col gap-2">
            <label className="text-white/90 text-sm">Provider</label>
            <Select
              value={llmForm.provider}
              onValueChange={(v) => {
                if (v === llmForm.provider) return;
                if (v === "openai") {
                  setLlmForm({ provider: "openai", apiKey: "" });
                } else if (v === "azure") {
                  setLlmForm({
                    provider: "azure",
                    apiKey: "",
                    endpoint: "",
                    version: "",
                    deployment: "",
                  });
                }
              }}
            >
              <SelectTrigger className="bg-black/40 cursor-pointer border border-white/20 text-white">
                <SelectValue placeholder="Select provider" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem className="cursor-pointer" value="openai">
                  OpenAI
                </SelectItem>
                <SelectItem
                  disabled={true}
                  className="cursor-pointer"
                  value="azure"
                >
                  Azure OpenAI
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          {llmForm.provider === "openai" ? (
            <OpenAIProviderForm llmForm={llmForm} setLlmForm={setLlmForm} />
          ) : (
            <AzureOpenAIProviderForm
              llmForm={llmForm}
              setLlmForm={setLlmForm}
            />
          )}
          <div className="flex justify-start gap-2">
            <Button
              variant="destructive"
              size="sm"
              className="cursor-pointer"
              onClick={onClear}
              disabled={!hasConfig}
            >
              Clear Config
            </Button>
            <Button
              variant="secondary"
              size="sm"
              className="cursor-pointer"
              onClick={onSave}
            >
              Save
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
