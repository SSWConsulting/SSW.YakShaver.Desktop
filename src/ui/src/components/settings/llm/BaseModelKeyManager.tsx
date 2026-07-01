import type { LLMConfigV2, ModelConfig, ProviderName } from "@shared/types/llm";
import { useCallback, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import type { ProviderOption } from "@/components/llm/LLMProviderFields";
import { formatErrorMessage } from "@/utils";
import { LLM_PROVIDER_CONFIGS } from "../../../../../shared/llm/llm-providers";
import { ipcClient } from "../../../services/ipc-client";
import type { HealthStatusInfo } from "../../../types";
import { SettingsSection } from "../SettingsSection";
import { type LLMProvider, LLMProviderForm } from "./LLMProviderForm";
import {
  buildConfigWithClearedModel,
  buildConfigWithSavedModel,
  getSavedApiKeyForProvider,
} from "./llm-config-utils";

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
        const freshConfig = await ipcClient.llm.getConfig();
        const configToSave = buildConfigWithSavedModel(freshConfig, modelType, values);
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
    [checkHealth, refreshStatus, modelType],
  );

  const onClear = useCallback(async () => {
    setIsLoading(true);
    try {
      const freshConfig = await ipcClient.llm.getConfig();
      const configToSave = buildConfigWithClearedModel(freshConfig, modelType);
      await ipcClient.llm.setConfig(configToSave);

      toast.success("LLM configuration cleared");
      setHealthStatus(null);
      setHasConfig(false);
      form.reset({
        provider: "openai",
        apiKey: "",
      });
      await refreshStatus();
    } catch (e) {
      toast.error(`Failed to clear configuration: ${formatErrorMessage(e)}`);
    } finally {
      setIsLoading(false);
    }
  }, [form, refreshStatus, modelType]);

  const handleProviderChange = async (value: LLMProvider) => {
    // Clear health status until we know whether the newly-selected provider is the saved one.
    setHealthStatus(null);

    // Fetch fresh config to restore the saved API key for this provider without losing any
    // other provider's key — providerApiKeys is the durable per-provider cache, but falls back
    // to the currently-saved model config below for configs that predate that cache.
    let savedKey = "";
    let freshConfig: LLMConfigV2 | null = null;
    try {
      freshConfig = await ipcClient.llm.getConfig();
      savedKey = getSavedApiKeyForProvider(freshConfig, modelType, value as ProviderName);
    } catch (_e) {
      // fall through with empty key
    }

    // The checkmark/health indicator must reflect the provider now shown in the dropdown, not
    // whichever provider happened to be saved before the switch.
    const savedModelForType = freshConfig?.[modelType];
    setHasConfig(savedModelForType?.provider === value && !!savedModelForType.apiKey);

    form.reset({
      provider: value,
      apiKey: savedKey,
      ...(value === "azure" ? { endpoint: "", version: "", deployment: "" } : {}),
    } as ModelConfig);
  };

  return (
    <SettingsSection title={title} description={description}>
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
    </SettingsSection>
  );
}
