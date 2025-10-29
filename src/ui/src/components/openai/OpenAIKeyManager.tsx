import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ipcClient } from "../../services/ipc-client";
import type { HealthStatusInfo, LLMConfig } from "../../types";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "../ui/dialog";
import { HealthStatus } from "../ui/health-status";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { AzureOpenAIProviderForm, OpenAIProviderForm } from "./OpenAIForm";

export function OpenAIKeyManager() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [hasConfig, setHasConfig] = useState(false);
  const [llmForm, setLlmForm] = useState<LLMConfig>({
    provider: "openai",
    apiKey: "",
  });
  const [healthStatus, setHealthStatus] = useState<HealthStatusInfo | null>(
    null
  );

  // Mask API key for display (show first 4 and last 4 chars with ellipsis)
  const maskKey = (key?: string) => {
    if (!key) return "";
    try {
      if (key.length <= 8) return "•".repeat(key.length);
      return `${key.slice(0, 4)}…${key.slice(-4)}`;
    } catch (_) {
      return "****";
    }
  };

  async function checkHealth() {
    setHealthStatus((prev) => ({
      isHealthy: prev?.isHealthy ?? false,
      error: prev?.error,
      successMessage: prev?.successMessage,
      isChecking: true,
    }));

    try {
      const result = (await ipcClient.llm.checkHealth()) as HealthStatusInfo;
      result.isChecking = false;
      setHealthStatus(result);
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : String(e);
      setHealthStatus({
        isHealthy: false,
        error: errorMessage,
        isChecking: false,
      });
    }
  }

  async function refreshStatus() {
    try {
      const cfg = await ipcClient.llm.getConfig();
      setHasConfig(!!cfg);
      if (cfg) {
        setLlmForm(cfg as LLMConfig);
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

  // Check health when dialog opens and config exists
  useEffect(() => {
    if (dialogOpen && hasConfig) {
      void checkHealth();
    }
  }, [dialogOpen, hasConfig]);

  async function onSave() {
    const apiKey = (llmForm.apiKey ?? "").trim();

    if (llmForm.provider === "openai" && !apiKey) {
      toast.error("Please enter a valid OpenAI API key");
      return;
    }

    if (llmForm.provider === "azure") {
      if (
        apiKey === "" ||
        !(llmForm.endpoint ?? "").trim() ||
        !(llmForm.version ?? "").trim() ||
        !(llmForm.deployment ?? "").trim()
      ) {
        toast.error("Please fill in all Azure OpenAI fields");
        return;
      }
    }

    try {
      await ipcClient.llm.setConfig(llmForm);
      toast.success(
        llmForm.provider === "openai"
          ? "OpenAI configuration saved"
          : "Azure OpenAI configuration saved"
      );
      await refreshStatus();
      await checkHealth();
    } catch (e) {
      toast.error("Failed to save configuration");
    }
  }

  async function onClear() {
    try {
      await ipcClient.llm.clearConfig();
      toast.success("LLM configuration cleared");
      setHealthStatus(null);
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
          {hasConfig && (
            <div className="flex items-center gap-3">
              <p className="text-white/80 text-sm">API Key Status:</p>
              <span className="text-green-400 text-sm font-mono">
                Saved{llmForm?.apiKey ? ` (${maskKey(llmForm.apiKey)})` : ""}
              </span>
              <HealthStatus
                isChecking={healthStatus?.isChecking ?? false}
                isHealthy={healthStatus?.isHealthy ?? false}
                successMessage={healthStatus?.successMessage}
                error={healthStatus?.error}
              />
            </div>
          )}
          {!hasConfig && (
            <p className="text-white/80 text-sm">
              Status: <span className="text-red-400">Not Saved</span>
            </p>
          )}
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
