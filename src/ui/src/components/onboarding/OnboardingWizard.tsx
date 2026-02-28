import type { LLMConfigV2, ModelConfig, ProviderName } from "@shared/types/llm";
import { CircleAlert, Mic } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { YouTubeConnection } from "@/components/auth/YouTubeConnection";
import { LLMProviderFields, type ProviderOption } from "@/components/llm/LLMProviderFields";
import { formatErrorMessage } from "@/utils";
import logo from "/logos/SQ-YakShaver-LogoIcon-Red.svg?url";
import cpu from "/onboarding/cpu.svg?url";
import monitorPlay from "/onboarding/monitor-play.svg?url";
import { LLM_PROVIDER_CONFIGS } from "../../../../shared/llm/llm-providers";
import { ONBOARDING_COMPLETED_KEY, ONBOARDING_FINISHED_EVENT } from "../../constants/onboarding";
import { useYouTubeAuth } from "../../contexts/YouTubeAuthContext";
import { ipcClient } from "../../services/ipc-client";
import type { HealthStatusInfo } from "../../types";
import { AuthStatus } from "../../types";
import { McpSettingsPanel } from "../settings/mcp/McpServerManager";
import { Button } from "../ui/button";
import { Form } from "../ui/form";
import { ScrollArea } from "../ui/scroll-area";

type ConnectorPosition = {
  top: number;
  height: number;
  left: number;
};

// Utility function to reset onboarding (can be called from settings)
export const resetOnboarding = () => {
  if (typeof window === "undefined") {
    return;
  }
  localStorage.removeItem(ONBOARDING_COMPLETED_KEY);
};

const STEPS = [
  {
    id: 1,
    icon: monitorPlay,
    title: "Video Hosting",
    description: "Choose a platform to host your videos.",
    sidebarDescription: "Authorise YakShaver to publish videos for you.",
    navSteps: [1],
  },
  {
    id: 2,
    icon: cpu,
    title: "Connecting an LLM",
    description: "Connect an LLM to transcribe your meetings and take your notes.",
    sidebarDescription: "Choose your provider and save the API details",
    navSteps: [2],
  },
  {
    id: 3,
    icon: monitorPlay,
    title: "Connecting an MCP",
    description: "Configure or Choose which MCP server YakShaver will call.",
    sidebarDescription: "Configure or choose which MCP server YakShaver will call.",
    navSteps: [3],
  },
];

const PROVIDER_NAMES = Object.keys(LLM_PROVIDER_CONFIGS) as ProviderName[];

const TRANSCRIPTION_PROVIDER_NAMES: ProviderOption[] = PROVIDER_NAMES.filter(
  (providerName) => LLM_PROVIDER_CONFIGS[providerName].defaultTranscriptionModel !== undefined,
).map((name) => ({ label: LLM_PROVIDER_CONFIGS[name].label, value: name }));

const LANGUAGE_PROVIDER_NAMES: ProviderOption[] = PROVIDER_NAMES.filter(
  (providerName) => LLM_PROVIDER_CONFIGS[providerName].defaultLanguageModel !== undefined,
).map((name) => ({ label: LLM_PROVIDER_CONFIGS[name].label, value: name }));

export function OnboardingWizard({
  onVisibilityChange,
}: {
  onVisibilityChange?: (isVisible: boolean) => void;
}) {
  const [currentStep, setCurrentStep] = useState(1);

  const [isMcpFormOpen, setIsMcpFormOpen] = useState(false);
  const [hasEnabledMcpServers, setHasEnabledMcpServers] = useState(false);
  const [currentLLMConfig, setCurrentLLMConfig] = useState<LLMConfigV2 | null>(null);
  const [hasLLMConfig, setHasLLMConfig] = useState(false);
  const [isLLMSaving, setIsLLMSaving] = useState(false);
  const [healthStatus, setHealthStatus] = useState<HealthStatusInfo | null>(null);
  const [isMCPSaving] = useState(false);
  const [isVisible, setIsVisible] = useState(() => {
    // Check if user has completed onboarding before
    const completed = localStorage.getItem(ONBOARDING_COMPLETED_KEY);
    return completed !== "true";
  });
  useEffect(() => {
    onVisibilityChange?.(isVisible);
  }, [isVisible, onVisibilityChange]);

  const stepListRef = useRef<HTMLDivElement | null>(null);
  const stepIconRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [connectorPositions, setConnectorPositions] = useState<ConnectorPosition[]>([]);
  const activeHealthCheckProvider = useRef<ProviderName | null>(null);

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

  const [hasTranscriptionConfig, setHasTranscriptionConfig] = useState(false);

  const languageProvider = llmForm.watch("provider") as ProviderName;
  const languageProviderSupportsTranscription =
    LLM_PROVIDER_CONFIGS[languageProvider]?.defaultTranscriptionModel !== undefined;

  const { authState } = useYouTubeAuth();

  const { status } = authState;
  const isConnected = status === AuthStatus.AUTHENTICATED;
  const updateConnectorPositions = useCallback(() => {
    window.requestAnimationFrame(() => {
      const container = stepListRef.current;
      if (!container) return;

      const containerRect = container.getBoundingClientRect();
      const positions: ConnectorPosition[] = [];

      for (let index = 0; index < stepIconRefs.current.length - 1; index++) {
        const currentIcon = stepIconRefs.current[index];
        const nextIcon = stepIconRefs.current[index + 1];

        if (!currentIcon || !nextIcon) {
          continue;
        }

        const currentRect = currentIcon.getBoundingClientRect();
        const nextRect = nextIcon.getBoundingClientRect();

        const top = currentRect.bottom - containerRect.top;
        const height = nextRect.top - currentRect.bottom;
        const left = currentRect.left - containerRect.left + currentRect.width / 2 - 0.5;

        if (height > 0) {
          positions.push({ top, height, left });
        }
      }

      setConnectorPositions(positions);
    });
  }, []);

  useEffect(() => {
    if (!isVisible) {
      return;
    }
    updateConnectorPositions();
  }, [isVisible, updateConnectorPositions]);

  useEffect(() => {
    window.addEventListener("resize", updateConnectorPositions);
    return () => {
      window.removeEventListener("resize", updateConnectorPositions);
    };
  }, [updateConnectorPositions]);

  // Check LLM configuration status when on step 2
  useEffect(() => {
    if (currentStep !== 2) return;

    const checkLLMConfig = async () => {
      try {
        const cfg = await ipcClient.llm.getConfig();

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
              if (activeHealthCheckProvider.current !== loadProvider) return;
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
              if (activeHealthCheckProvider.current !== loadProvider) return;
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
          // No saved language model — default to OpenAI, restore key from providerApiKeys if available
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
        setHasLLMConfig(false);
        setHasTranscriptionConfig(false);
      }
    };

    void checkLLMConfig();
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

  const handleProviderChange = async (value: ProviderName) => {
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
  };

  const handleTranscriptionProviderChange = async (value: ProviderName) => {
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
  };

  // Auto-validate language model API key on input change
  useEffect(() => {
    if (currentStep !== 2) return;

    const subscription = llmForm.watch(async (value, { name }) => {
      if (name === "apiKey" && value.apiKey && value.apiKey.length > 10) {
        const timeoutId = setTimeout(async () => {
          setIsLLMSaving(true);
          setHealthStatus({ isHealthy: false, isChecking: true });

          try {
            const values = llmForm.getValues();
            const provider = values.provider as ProviderName;
            activeHealthCheckProvider.current = provider;
            const supportsTranscription =
              LLM_PROVIDER_CONFIGS[provider]?.defaultTranscriptionModel !== undefined;

            const configToSave: LLMConfigV2 = {
              version: 2,
              languageModel: values as ModelConfig,
              transcriptionModel: supportsTranscription
                ? (values as ModelConfig)
                : (currentLLMConfig?.transcriptionModel ?? null),
              providerApiKeys: {
                ...currentLLMConfig?.providerApiKeys,
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

        return () => clearTimeout(timeoutId);
      } else if (name === "apiKey") {
        setHealthStatus(null);
        setHasLLMConfig(false);
      }
    });

    return () => subscription.unsubscribe();
  }, [llmForm, currentLLMConfig, currentStep, transcriptionForm]);

  // Auto-save transcription model API key on input change
  useEffect(() => {
    if (currentStep !== 2 || languageProviderSupportsTranscription) return;

    const subscription = transcriptionForm.watch(async (value, { name }) => {
      if (name === "apiKey" && value.apiKey && value.apiKey.length > 10) {
        const timeoutId = setTimeout(async () => {
          try {
            const values = transcriptionForm.getValues();
            const updatedProviderApiKeys = {
              ...(currentLLMConfig?.providerApiKeys ?? {}),
              [(values as ModelConfig).provider as ProviderName]: (values as ModelConfig).apiKey,
            };
            const configToSave: LLMConfigV2 = {
              version: 2,
              languageModel: currentLLMConfig?.languageModel ?? null,
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

        return () => clearTimeout(timeoutId);
      } else if (name === "apiKey") {
        setHasTranscriptionConfig(false);
      }
    });

    return () => subscription.unsubscribe();
  }, [transcriptionForm, currentLLMConfig, currentStep, languageProviderSupportsTranscription]);

  const completeOnboarding = useCallback(() => {
    localStorage.setItem(ONBOARDING_COMPLETED_KEY, "true");
    window.dispatchEvent(new CustomEvent(ONBOARDING_FINISHED_EVENT));
    setIsVisible(false);
  }, []);

  const handleLLMStepNext = useCallback(async () => {
    const isValid = await llmForm.trigger();
    if (!isValid) return false;

    if (!hasLLMConfig || !healthStatus?.isHealthy) {
      toast.error("Please enter a valid API key before proceeding");
      return false;
    }

    if (!hasTranscriptionConfig) {
      toast.error("Please configure a transcription model before proceeding");
      return false;
    }

    toast.success("LLM configuration saved");
    setCurrentStep((s) => s + 1);
    return true;
  }, [hasLLMConfig, hasTranscriptionConfig, healthStatus?.isHealthy, llmForm]);

  const handleNext = async () => {
    if (currentStep === 2) {
      await handleLLMStepNext();
      return;
    }

    if (currentStep === 3) {
      completeOnboarding();
      return;
    }

    if (currentStep < STEPS.length) {
      setCurrentStep((step) => step + 1);
    }
  };

  const handlePrevious = () => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1);
    }
  };

  const getSidebarStepStatus = (sidebarStep: (typeof STEPS)[number]) => {
    const navSteps = sidebarStep.navSteps;
    if (navSteps.some((s) => s === currentStep)) return "current";
    if (navSteps.every((s) => s < currentStep)) return "completed";
    return "pending";
  };

  const isNextDisabled =
    (currentStep === 1 && !isConnected) ||
    (currentStep === 2 &&
      (isLLMSaving || !hasLLMConfig || !healthStatus?.isHealthy || !hasTranscriptionConfig)) ||
    (currentStep === 3 && (isMCPSaving || !hasEnabledMcpServers));

  if (!isVisible) return null;

  const rightPanelContent = (
    <div className="flex flex-col w-full max-w-[599px]">
      {/* Step indicator */}
      <div className="px-6">
        <p className="text-sm font-medium leading-6 text-white">
          Step {currentStep} of {STEPS.length}
        </p>
      </div>

      {/* Card header */}
      <div className="flex flex-col gap-1.5 p-6 w-full">
        <p className="text-2xl font-semibold leading-6 tracking-[-0.015em] text-white/[0.98]">
          {STEPS[currentStep - 1].title}
        </p>
        <p className="text-sm font-normal leading-5 text-white/[0.56]">
          {STEPS[currentStep - 1].description}
        </p>
      </div>

      {/* Card content */}
      <div className="flex flex-col gap-6 px-6 pb-6 w-full">
        {currentStep === 1 && <YouTubeConnection buttonSize="lg" />}

        {currentStep === 2 && (
          <>
            {/* Section title */}
            <p className="text-sm font-medium text-white">Choose your LLM</p>

            {/* Language Model Section */}
            <div className="w-full">
              <p className="mb-3 text-xs font-medium uppercase leading-4 text-white/60">LLM</p>
              <Form {...llmForm}>
                <form
                  onSubmit={llmForm.handleSubmit(handleLLMSubmit)}
                  className="flex flex-col gap-4"
                >
                  <LLMProviderFields
                    control={llmForm.control}
                    providerField="provider"
                    apiKeyField="apiKey"
                    providerOptions={LANGUAGE_PROVIDER_NAMES}
                    onProviderChange={(value) => handleProviderChange(value as ProviderName)}
                    healthStatus={healthStatus}
                    selectContentClassName="z-[70]"
                  />
                </form>
              </Form>
            </div>

            {/* Warning when provider doesn't support transcription */}
            {!languageProviderSupportsTranscription && (
              <div className="flex items-start gap-3 rounded-md border border-destructive/50 p-4">
                <CircleAlert className="mt-0.5 size-4 shrink-0 text-destructive" />
                <div>
                  <p className="text-sm font-medium text-destructive">
                    Transcription Model Required
                  </p>
                  <p className="text-sm text-destructive/70">
                    {LLM_PROVIDER_CONFIGS[languageProvider]?.label} doesn&apos;t support video
                    transcription. Please add a model for transcription.
                  </p>
                </div>
              </div>
            )}

            {/* Transcription Model Section */}
            {!languageProviderSupportsTranscription && (
              <div className="flex w-full flex-col gap-4 rounded-lg border border-white/20 p-4">
                <div className="flex items-center gap-2">
                  <Mic className="size-4 text-white/70" />
                  <p className="text-sm font-medium text-white">Transcription Model</p>
                </div>
                <Form {...transcriptionForm}>
                  <form className="flex flex-col gap-4">
                    <LLMProviderFields
                      control={transcriptionForm.control}
                      providerField="provider"
                      apiKeyField="apiKey"
                      providerOptions={TRANSCRIPTION_PROVIDER_NAMES}
                      onProviderChange={(value) =>
                        handleTranscriptionProviderChange(value as ProviderName)
                      }
                      selectContentClassName="z-[70]"
                    />
                  </form>
                </Form>
              </div>
            )}
          </>
        )}

        {currentStep === 3 && (
          <McpSettingsPanel
            onFormOpenChange={setIsMcpFormOpen}
            onHasEnabledServers={setHasEnabledMcpServers}
            includeBuiltin={false}
            viewMode="compact"
          />
        )}
      </div>

      {/* Card footer */}
      {!isMcpFormOpen && (
        <div className="flex h-16 items-center justify-end px-6 w-full">
          <div
            className={`flex items-center w-full ${
              currentStep > 1 ? "justify-between" : "justify-end"
            }`}
          >
            {currentStep > 1 && (
              <Button
                className="flex items-center justify-center px-4 py-2"
                type="button"
                variant="outline"
                size="sm"
                onClick={handlePrevious}
              >
                Previous
              </Button>
            )}

            <Button
              className="flex items-center justify-center px-4 py-2"
              size="sm"
              onClick={handleNext}
              disabled={isNextDisabled}
            >
              {currentStep === 2 && isLLMSaving
                ? "Checking..."
                : currentStep === 3 && isMCPSaving
                  ? "Saving..."
                  : currentStep === STEPS.length
                    ? "Finish"
                    : "Next"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div className="fixed inset-0 z-[40] flex items-center justify-center">
      <div className="fixed inset-0 bg-[url('/background/YakShaver-Background.jpg')] bg-cover bg-center bg-no-repeat"></div>

      <div className="relative flex w-full max-w-[1295px] h-[840px] bg-black/[0.44] border border-white/[0.24] rounded-lg shadow-sm p-2.5 gap-10">
        <div className="hidden md:flex flex-col items-center md:w-[360px] lg:w-[440px] xl:w-[480px] h-full bg-[#1C0D05] rounded-md px-5 pt-[150px] pb-[150px]">
          <div className="w-[300px]">
            {/* Logo */}
            <div className="flex items-center mb-3">
              <img src={logo} alt="YakShaver" className="w-18 h-auto pr-2.5" />
              <span className="text-3xl font-bold text-ssw-red">Yak</span>
              <span className="text-3xl">Shaver</span>
            </div>
            <p className="text-base font-normal leading-5 text-white/[0.76] pb-6">
              Get started by setting up your workspace.
            </p>

            <div ref={stepListRef} className="relative flex gap-10 flex-col">
              {connectorPositions.map((position, index) => {
                const nextSidebarStep = STEPS[index + 1];
                if (!nextSidebarStep) return null;

                const status = getSidebarStepStatus(nextSidebarStep);

                return (
                  <div
                    key={`connector-${nextSidebarStep.id}`}
                    className={`absolute w-px transition-colors duration-300 ${
                      status === "pending" ? "bg-[#432A1D]" : "bg-[#75594B]"
                    }`}
                    style={{
                      left: position.left,
                      top: position.top,
                      height: position.height,
                    }}
                  ></div>
                );
              })}

              {STEPS.map((step, index) => {
                const status = getSidebarStepStatus(step);
                return (
                  <div key={step.id} className="flex gap-8">
                    <div className="flex flex-col items-center">
                      <div
                        ref={(element) => {
                          stepIconRefs.current[index] = element;
                        }}
                        className={`w-10 h-10 rounded-full flex items-center justify-center transition-colors duration-300 ${
                          status === "pending" ? "bg-[#432A1D]" : "bg-[#75594B]"
                        }`}
                      >
                        <img
                          src={step.icon}
                          alt={step.title}
                          className={`w-6 h-6 transition-opacity duration-300 ${
                            status === "pending" ? "opacity-40" : "opacity-100"
                          }`}
                        />
                      </div>
                    </div>

                    <div className="flex flex-col justify-center w-[219px]">
                      <p
                        className={`text-sm font-medium leading-5 transition-opacity duration-300 ${
                          status === "pending" ? "text-white/[0.65]" : "text-white/[0.98]"
                        }`}
                      >
                        {step.title}
                      </p>
                      <p className="text-sm font-normal leading-5 text-white/[0.55]">
                        {step.sidebarDescription}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
        <div className="flex flex-col flex-1 min-w-0 h-full">
          {currentStep === 2 ? (
            <div className="flex flex-col items-center justify-center w-full h-full px-20 py-10">
              {rightPanelContent}
            </div>
          ) : currentStep === 3 ? (
            <ScrollArea className="w-full h-full">
              <div className="flex flex-col px-20 py-40">{rightPanelContent}</div>
            </ScrollArea>
          ) : (
            <div className="flex flex-col w-full px-20 py-40">{rightPanelContent}</div>
          )}
        </div>
      </div>
    </div>
  );
}
