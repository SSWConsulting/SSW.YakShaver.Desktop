import { LLM_PROVIDER_CONFIGS } from "@shared/llm/llm-providers";
import type { LLMConfigV2, ModelConfig, ProviderName } from "@shared/types/llm";
import { useCallback, useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { formatErrorMessage } from "@/utils";
import { ipcClient } from "../services/ipc-client";
import type { HealthStatusInfo } from "../types";
import { LLM_STEP_ID } from "../types/onboarding";

export function useOnboardingLLM(currentStep: number) {
  const [currentLLMConfig, setCurrentLLMConfig] = useState<LLMConfigV2 | null>(null);
  const [hasLLMConfig, setHasLLMConfig] = useState(false);
  const [isLLMSaving, setIsLLMSaving] = useState(false);
  const [healthStatus, setHealthStatus] = useState<HealthStatusInfo | null>(null);
  const [hasTranscriptionConfig, setHasTranscriptionConfig] = useState(false);
  const activeHealthCheckProvider = useRef<ProviderName | null>(null);
  const llmDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const transcriptionDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const llmForm = useForm<ModelConfig>({
    defaultValues: {
      provider: "openai",
      apiKey: "",
    },
  });

  const transcriptionForm = useForm<ModelConfig>({
    defaultValues: {
      provider: "openai",
      apiKey: "",
    },
  });

  const languageProvider = llmForm.watch("provider") as ProviderName;
  const languageProviderSupportsTranscription =
    LLM_PROVIDER_CONFIGS[languageProvider]?.defaultTranscriptionModel !== undefined;

  // Check LLM configuration status when on the LLM step
  useEffect(() => {
    if (currentStep !== LLM_STEP_ID) return;

    let cancelled = false;

    const checkLLMConfig = async () => {
      try {
        const cfg = await ipcClient.llm.getConfig();
        if (cancelled) return;

        // Bootstrap providerApiKeys from existing languageModel if missing (migration path)
        let enrichedCfg = cfg;
        if (cfg?.languageModel?.apiKey && !cfg.providerApiKeys?.[cfg.languageModel.provider]) {
          enrichedCfg = {
            ...cfg,
            providerApiKeys: {
              ...cfg.providerApiKeys,
              [cfg.languageModel.provider]: cfg.languageModel.apiKey,
            },
          };
        }
        setCurrentLLMConfig(enrichedCfg);

        // Load language model config
        const langCfg = enrichedCfg?.languageModel;
        setHasLLMConfig(!!langCfg);
        if (langCfg) {
          llmForm.reset(langCfg);

          if (langCfg.apiKey) {
            const loadProvider = langCfg.provider;
            activeHealthCheckProvider.current = loadProvider;
            setIsLLMSaving(true);
            setHealthStatus({ isHealthy: false, isChecking: true });
            try {
              const healthResult = await ipcClient.llm.checkHealth();
              if (cancelled || activeHealthCheckProvider.current !== loadProvider) return;
              if (!healthResult.isHealthy) {
                setHealthStatus({
                  isHealthy: false,
                  isChecking: false,
                  error: healthResult.error || "Failed to connect to LLM provider",
                });
                setHasLLMConfig(false);
              } else {
                setHealthStatus({
                  isHealthy: true,
                  isChecking: false,
                  successMessage: healthResult.successMessage || "API key validated successfully",
                });
                setHasLLMConfig(true);
              }
            } catch (e) {
              if (cancelled || activeHealthCheckProvider.current !== loadProvider) return;
              setHealthStatus({
                isHealthy: false,
                isChecking: false,
                error: formatErrorMessage(e),
              });
              setHasLLMConfig(false);
            } finally {
              setIsLLMSaving(false);
            }
          }
        } else {
          // No saved language model — default to OpenAI, restore key from providerApiKeys
          const savedOpenAIKey = enrichedCfg?.providerApiKeys?.openai ?? "";
          llmForm.reset({ provider: "openai", apiKey: savedOpenAIKey });
          setHealthStatus(null);

          if (savedOpenAIKey.length > 10) {
            llmForm.setValue("apiKey", savedOpenAIKey, { shouldDirty: true });
          }
        }

        // Load transcription model config
        const transCfg = enrichedCfg?.transcriptionModel;
        if (transCfg) {
          setHasTranscriptionConfig(true);
          transcriptionForm.reset(transCfg);
        } else if (
          langCfg &&
          LLM_PROVIDER_CONFIGS[langCfg.provider]?.defaultTranscriptionModel !== undefined
        ) {
          // Language provider supports transcription, so transcription is implicitly ready
          setHasTranscriptionConfig(true);
          transcriptionForm.reset({
            provider: langCfg.provider,
            apiKey: langCfg.apiKey,
          } as ModelConfig);
        } else {
          setHasTranscriptionConfig(false);
          transcriptionForm.reset({ provider: "openai", apiKey: "" });
        }
      } catch (_error) {
        if (cancelled) return;
        setHasLLMConfig(false);
        setHasTranscriptionConfig(false);
      }
    };

    void checkLLMConfig();

    return () => {
      cancelled = true;
    };
  }, [currentStep, llmForm, transcriptionForm]);

  const handleLLMSubmit = useCallback(
    async (values: ModelConfig) => {
      setIsLLMSaving(true);
      try {
        const provider = values.provider;
        const supportsTranscription =
          LLM_PROVIDER_CONFIGS[provider]?.defaultTranscriptionModel !== undefined;

        const configToSave: LLMConfigV2 = {
          version: 2,
          languageModel: values,
          transcriptionModel: supportsTranscription
            ? values
            : (currentLLMConfig?.transcriptionModel ?? null),
          providerApiKeys: {
            ...currentLLMConfig?.providerApiKeys,
            [provider]: values.apiKey,
          },
        };
        await ipcClient.llm.setConfig(configToSave);
        toast.success(`${LLM_PROVIDER_CONFIGS[provider].label} configuration saved`);
        setHasLLMConfig(true);
        if (supportsTranscription) {
          setHasTranscriptionConfig(true);
        }
      } catch (e) {
        toast.error(`Failed to save configuration: ${formatErrorMessage(e)}`);
      } finally {
        setIsLLMSaving(false);
      }
    },
    [currentLLMConfig],
  );

  const handleProviderChange = useCallback(
    async (value: ProviderName) => {
      // Always fetch fresh config to avoid stale providerApiKeys after settings changes
      let freshConfig: LLMConfigV2 | null = null;
      try {
        freshConfig = await ipcClient.llm.getConfig();
        setCurrentLLMConfig(freshConfig);
      } catch (_e) {
        // fall through with null
      }

      const savedKey = freshConfig?.providerApiKeys?.[value] ?? "";
      llmForm.reset({ provider: value, apiKey: savedKey } as ModelConfig);
      setHealthStatus(null);
      setHasLLMConfig(false);
      activeHealthCheckProvider.current = null;

      const supportsTranscription =
        LLM_PROVIDER_CONFIGS[value]?.defaultTranscriptionModel !== undefined;
      if (supportsTranscription) {
        transcriptionForm.reset({ provider: value, apiKey: "" } as ModelConfig);
        setHasTranscriptionConfig(false);
      } else {
        transcriptionForm.reset({ provider: "openai", apiKey: "" });
        setHasTranscriptionConfig(false);
      }

      // If a saved key was restored, trigger the watch to re-run the health check
      if (savedKey.length > 10) {
        llmForm.setValue("apiKey", savedKey, { shouldDirty: true });
      }
    },
    [llmForm, transcriptionForm],
  );

  const handleTranscriptionProviderChange = useCallback(
    async (value: ProviderName) => {
      let freshConfig: LLMConfigV2 | null = null;
      try {
        freshConfig = await ipcClient.llm.getConfig();
        setCurrentLLMConfig(freshConfig);
      } catch (_e) {
        // fall through with null
      }

      const savedKey = freshConfig?.providerApiKeys?.[value] ?? "";
      transcriptionForm.reset({ provider: value, apiKey: savedKey } as ModelConfig);
      setHasTranscriptionConfig(false);

      // Trigger the auto-save watch subscription so the restored key gets saved
      if (savedKey.length > 10) {
        transcriptionForm.setValue("apiKey", savedKey, { shouldDirty: true });
      }
    },
    [transcriptionForm],
  );

  // Auto-validate language model API key on input change
  useEffect(() => {
    if (currentStep !== LLM_STEP_ID) return;

    const subscription = llmForm.watch(async (value, { name }) => {
      if (name === "apiKey" && value.apiKey && value.apiKey.length > 10) {
        if (llmDebounceRef.current) clearTimeout(llmDebounceRef.current);
        llmDebounceRef.current = setTimeout(async () => {
          setIsLLMSaving(true);
          setHealthStatus({ isHealthy: false, isChecking: true });

          try {
            const values = llmForm.getValues();
            const provider = values.provider as ProviderName;
            activeHealthCheckProvider.current = provider;
            const supportsTranscription =
              LLM_PROVIDER_CONFIGS[provider]?.defaultTranscriptionModel !== undefined;

            // Fetch fresh config to avoid stale providerApiKeys
            let freshConfig: LLMConfigV2 | null = null;
            try {
              freshConfig = await ipcClient.llm.getConfig();
            } catch (_e) {
              // fall through with null
            }

            const configToSave: LLMConfigV2 = {
              version: 2,
              languageModel: values as ModelConfig,
              transcriptionModel: supportsTranscription
                ? (values as ModelConfig)
                : (freshConfig?.transcriptionModel ?? null),
              providerApiKeys: {
                ...freshConfig?.providerApiKeys,
                [provider]: (values as ModelConfig).apiKey,
              },
            };
            await ipcClient.llm.setConfig(configToSave);
            if (activeHealthCheckProvider.current !== provider) return;
            setCurrentLLMConfig(configToSave);

            if (supportsTranscription) {
              transcriptionForm.reset(values as ModelConfig);
              setHasTranscriptionConfig(true);
            }

            const healthResult = await ipcClient.llm.checkHealth();
            if (activeHealthCheckProvider.current !== provider) return;
            if (!healthResult.isHealthy) {
              setHealthStatus({
                isHealthy: false,
                isChecking: false,
                error: healthResult.error || "Failed to connect to LLM provider",
              });
              setHasLLMConfig(false);
            } else {
              setHealthStatus({
                isHealthy: true,
                isChecking: false,
                successMessage: healthResult.successMessage || "API key validated successfully",
              });
              setHasLLMConfig(true);
            }
          } catch (e) {
            const provider = llmForm.getValues("provider") as ProviderName;
            if (activeHealthCheckProvider.current !== provider) return;
            setHealthStatus({
              isHealthy: false,
              isChecking: false,
              error: formatErrorMessage(e),
            });
            setHasLLMConfig(false);
          } finally {
            setIsLLMSaving(false);
          }
        }, 500);
      } else if (name === "apiKey") {
        setHealthStatus(null);
        setHasLLMConfig(false);
      }
    });

    return () => {
      subscription.unsubscribe();
      if (llmDebounceRef.current) clearTimeout(llmDebounceRef.current);
    };
  }, [llmForm, currentStep, transcriptionForm]);

  // Auto-save transcription model API key on input change
  useEffect(() => {
    if (currentStep !== LLM_STEP_ID || languageProviderSupportsTranscription) return;

    const subscription = transcriptionForm.watch(async (value, { name }) => {
      if (name === "apiKey" && value.apiKey && value.apiKey.length > 10) {
        if (transcriptionDebounceRef.current) clearTimeout(transcriptionDebounceRef.current);
        transcriptionDebounceRef.current = setTimeout(async () => {
          try {
            const values = transcriptionForm.getValues();

            // Fetch fresh config to avoid stale providerApiKeys
            let freshConfig: LLMConfigV2 | null = null;
            try {
              freshConfig = await ipcClient.llm.getConfig();
            } catch (_e) {
              // fall through with null
            }

            const updatedProviderApiKeys = {
              ...(freshConfig?.providerApiKeys ?? {}),
              [(values as ModelConfig).provider as ProviderName]: (values as ModelConfig).apiKey,
            };
            const configToSave: LLMConfigV2 = {
              version: 2,
              languageModel: freshConfig?.languageModel ?? null,
              transcriptionModel: values as ModelConfig,
              providerApiKeys: updatedProviderApiKeys,
            };
            await ipcClient.llm.setConfig(configToSave);
            setCurrentLLMConfig(configToSave);
            setHasTranscriptionConfig(true);
          } catch (_e) {
            setHasTranscriptionConfig(false);
          }
        }, 500);
      } else if (name === "apiKey") {
        setHasTranscriptionConfig(false);
      }
    });

    return () => {
      subscription.unsubscribe();
      if (transcriptionDebounceRef.current) clearTimeout(transcriptionDebounceRef.current);
    };
  }, [transcriptionForm, currentStep, languageProviderSupportsTranscription]);

  return {
    currentLLMConfig,
    hasLLMConfig,
    isLLMSaving,
    healthStatus,
    hasTranscriptionConfig,
    languageProviderSupportsTranscription,
    llmForm,
    transcriptionForm,
    handleLLMSubmit,
    handleProviderChange,
    handleTranscriptionProviderChange,
  };
}
