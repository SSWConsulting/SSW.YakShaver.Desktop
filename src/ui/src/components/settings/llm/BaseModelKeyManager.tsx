import type { LLMConfigV2, ModelConfig, ProviderName } from "@shared/types/llm";
import { useCallback, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import type { ProviderOption } from "@/components/llm/LLMProviderFields";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatErrorMessage } from "@/utils";
import { LLM_PROVIDER_CONFIGS } from "../../../../../shared/llm/llm-providers";
import { ipcClient } from "../../../services/ipc-client";
import type { HealthStatusInfo } from "../../../types";
import { type LLMProvider, LLMProviderForm } from "./LLMProviderForm";

interface BaseModelKeyManagerProps {
  isActive: boolean;
  modelType: "languageModel" | "transcriptionModel";
  title: string;
  description: string;
}

const PROVIDER_NAMES = Object.keys(LLM_PROVIDER_CONFIGS) as ProviderName[];

const TRANSCRIPTION_PROVIDER_NAMES: ProviderOption[] = PROVIDER_NAMES.filter(
  (providerName) => LLM_PROVIDER_CONFIGS[providerName].defaultTranscriptionModel !== undefined,
).map((name) => ({ label: LLM_PROVIDER_CONFIGS[name].label, value: name }));

const LANGUAGE_PROVIDER_NAMES: ProviderOption[] = PROVIDER_NAMES.filter(
  (providerName) => LLM_PROVIDER_CONFIGS[providerName].defaultLanguageModel !== undefined,
).map((name) => ({ label: LLM_PROVIDER_CONFIGS[name].label, value: name }));

export function BaseModelKeyManager({
  isActive,
  modelType,
  title,
  description,
}: BaseModelKeyManagerProps) {
  const [hasConfig, setHasConfig] = useState(false);
  const [healthStatus, setHealthStatus] = useState<HealthStatusInfo | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [currentLLMConfig, setCurrentLLMConfig] = useState<LLMConfigV2 | null>(null);

  const form = useForm<ModelConfig>({
    defaultValues: {
      provider: "openai",
      apiKey: "",
    },
    mode: "onSubmit",
  });

  const refreshStatus = useCallback(async () => {
    try {
      const cfg = await ipcClient.llm.getConfig();
      const processCfg = cfg?.[modelType];
      setHasConfig(!!processCfg);
      setCurrentLLMConfig(cfg);
      form.reset(
        processCfg ?? {
          provider: "openai",
          apiKey: "",
        },
      );
    } catch (e) {
      console.error(formatErrorMessage(e));
    }
  }, [form, modelType]);

  const checkHealth = useCallback(async () => {
    setHealthStatus((prev) => ({
      isHealthy: prev?.isHealthy ?? false,
      error: prev?.error,
      successMessage: prev?.successMessage,
      isChecking: true,
    }));
    if (modelType !== "languageModel") {
      setHealthStatus(null);
      return;
    }
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
  }, [modelType]);

  useEffect(() => {
    if (isActive) {
      void refreshStatus();
    }
  }, [isActive, refreshStatus]);

  useEffect(() => {
    if (isActive && hasConfig) {
      void checkHealth();
    }
  }, [isActive, hasConfig, checkHealth]);

  const onSubmit = useCallback(
    async (values: ModelConfig) => {
      setIsLoading(true);
      try {
        const configToSave: LLMConfigV2 = {
          version: 2,
          languageModel: currentLLMConfig?.languageModel ?? null,
          transcriptionModel: currentLLMConfig?.transcriptionModel ?? null,
          providerApiKeys: {
            ...currentLLMConfig?.providerApiKeys,
            [values.provider]: values.apiKey,
          },
          [modelType]: values,
        };
        await ipcClient.llm.setConfig(configToSave);
        const providerName =
          values.provider === "openai"
            ? "OpenAI"
            : values.provider === "deepseek"
              ? "DeepSeek"
              : "Azure OpenAI";

        toast.success(
          `${providerName} ${
            modelType === "transcriptionModel" ? "transcription " : ""
          }configuration saved`,
        );
        await refreshStatus();
        await checkHealth();
      } catch (e) {
        toast.error(`Failed to save configuration: ${formatErrorMessage(e)}`);
      } finally {
        setIsLoading(false);
      }
    },
    [checkHealth, refreshStatus, currentLLMConfig, modelType],
  );

  const onClear = useCallback(async () => {
    setIsLoading(true);
    try {
      await ipcClient.llm.setConfig({
        ...(currentLLMConfig as LLMConfigV2),
        providerApiKeys: {},
        [modelType]: null,
      });

      toast.success("LLM configuration cleared");
      setHealthStatus(null);
      await refreshStatus();
    } catch (e) {
      toast.error(`Failed to clear configuration: ${formatErrorMessage(e)}`);
    } finally {
      setIsLoading(false);
    }
  }, [refreshStatus, currentLLMConfig, modelType]);

  const handleProviderChange = async (value: LLMProvider) => {
    // Clear health status for the new provider
    setHealthStatus(null);

    // Fetch fresh config to restore saved API key for this provider
    let savedKey = "";
    try {
      const freshConfig = await ipcClient.llm.getConfig();
      setCurrentLLMConfig(freshConfig);
      savedKey = freshConfig?.providerApiKeys?.[value as ProviderName] ?? "";
    } catch (_e) {
      // fall through with empty key
    }

    form.reset({
      provider: value,
      apiKey: savedKey,
      ...(value === "azure" ? { endpoint: "", version: "", deployment: "" } : {}),
    } as ModelConfig);
  };

  return (
    <Card className="w-full gap-4 border-white/10 py-4">
      <CardHeader className="px-4">
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="px-4">
        <LLMProviderForm
          form={form}
          onSubmit={onSubmit}
          onClear={onClear}
          isLoading={isLoading}
          hasConfig={hasConfig}
          handleProviderChange={handleProviderChange}
          providerOptions={
            modelType === "languageModel" ? LANGUAGE_PROVIDER_NAMES : TRANSCRIPTION_PROVIDER_NAMES
          }
          healthStatus={modelType === "languageModel" ? healthStatus : undefined}
        />
      </CardContent>
    </Card>
  );
}
