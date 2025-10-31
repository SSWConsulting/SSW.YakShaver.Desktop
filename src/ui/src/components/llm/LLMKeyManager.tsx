import { zodResolver } from "@hookform/resolvers/zod";
import { useCallback, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import * as z from "zod";
import { formatErrorMessage } from "@/utils";
import { ipcClient } from "../../services/ipc-client";
import type { HealthStatusInfo, LLMConfig } from "../../types";
import { HealthStatus } from "../health-status/health-status";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "../ui/dialog";
import { type LLMProvider, LLMProviderForm } from "./LLMProviderForm";

const schema = z.discriminatedUnion("provider", [
  z.object({
    provider: z.literal("openai"),
    apiKey: z.string().min(1, "API key is required"),
  }),
  z.object({
    provider: z.literal("azure"),
    apiKey: z.string().min(1, "API key is required"),
    endpoint: z.string().min(1, "Endpoint is required"),
    version: z.string().min(1, "Version is required"),
    deployment: z.string().min(1, "Deployment is required"),
  }),
]);

export type FormValues = z.infer<typeof schema>;

export function LLMKeyManager() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [hasConfig, setHasConfig] = useState(false);
  const [healthStatus, setHealthStatus] = useState<HealthStatusInfo | null>(
    null
  );
  const [isLoading, setIsLoading] = useState(false);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      provider: "openai",
      apiKey: "",
    },
    mode: "onSubmit",
  });

  const refreshStatus = useCallback(async () => {
    try {
      const cfg = await ipcClient.llm.getConfig();
      setHasConfig(!!cfg);
      form.reset((cfg as FormValues) ?? { provider: "openai", apiKey: "" });
    } catch (e) {
      console.error(formatErrorMessage(e));
    }
  }, [form]);

  const checkHealth = useCallback(async () => {
    setHealthStatus((prev) => ({
      isHealthy: prev?.isHealthy ?? false,
      error: prev?.error,
      successMessage: prev?.successMessage,
      isChecking: true,
    }));
    try {
      const result = (await ipcClient.llm.checkHealth()) as HealthStatusInfo;
      setHealthStatus({ ...result, isChecking: false });
    } catch (e) {
      setHealthStatus({
        isHealthy: false,
        error: formatErrorMessage(e),
        isChecking: false,
      });
    }
  }, []);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  useEffect(() => {
    if (dialogOpen && hasConfig) {
      void checkHealth();
    }
  }, [dialogOpen, hasConfig, checkHealth]);

  const onSubmit = useCallback(
    async (values: FormValues) => {
      setIsLoading(true);
      try {
        await ipcClient.llm.setConfig(values as LLMConfig);
        toast.success(
          values.provider === "openai"
            ? "OpenAI configuration saved"
            : "Azure OpenAI configuration saved"
        );
        await refreshStatus();
        await checkHealth();
      } catch (e) {
        toast.error(`Failed to save configuration: ${formatErrorMessage(e)}`);
      } finally {
        setIsLoading(false);
      }
    },
    [checkHealth, refreshStatus]
  );

  const onClear = useCallback(async () => {
    setIsLoading(true);
    try {
      await ipcClient.llm.clearConfig();
      toast.success("LLM configuration cleared");
      setHealthStatus(null);
      await refreshStatus();
    } catch (e) {
      toast.error(`Failed to clear configuration: ${formatErrorMessage(e)}`);
    } finally {
      setIsLoading(false);
    }
  }, [refreshStatus]);

  const handleProviderChange = (value: LLMProvider) => {
    form.reset({
      provider: value,
      apiKey: "",
      ...(value === "azure"
        ? { endpoint: "", version: "", deployment: "" }
        : {}),
    } as FormValues);
  };

  return (
    <Dialog
      open={dialogOpen}
      onOpenChange={(open) => {
        setDialogOpen(open);
        if (open) void refreshStatus();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="secondary">LLM Settings</Button>
      </DialogTrigger>
      <DialogContent className="max-w-md bg-neutral-900 text-neutral-100 border-neutral-800">
        <DialogHeader>
          <DialogTitle className="text-white text-xl">LLM Settings</DialogTitle>
        </DialogHeader>
        {hasConfig && (
          <div className="flex items-center gap-3 mb-4">
            <p className="text-white/80 text-sm">API Key Status:</p>
            <span className="text-green-400 text-sm font-mono">Saved</span>
            <HealthStatus
              isChecking={healthStatus?.isChecking ?? false}
              isHealthy={healthStatus?.isHealthy ?? false}
              successMessage={healthStatus?.successMessage}
              error={healthStatus?.error}
            />
          </div>
        )}
        {!hasConfig && (
          <p className="text-white/80 text-sm mb-4">
            Status: <span className="text-red-400">Not Saved</span>
          </p>
        )}
        <LLMProviderForm
          form={form}
          onSubmit={onSubmit}
          onClear={onClear}
          isLoading={isLoading}
          hasConfig={hasConfig}
          handleProviderChange={handleProviderChange}
        />
      </DialogContent>
    </Dialog>
  );
}
