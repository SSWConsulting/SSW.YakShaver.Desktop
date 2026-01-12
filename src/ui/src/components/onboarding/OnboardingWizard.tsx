import { zodResolver } from "@hookform/resolvers/zod";
import type { LLMConfig } from "@shared/types/llm";
import { useCallback, useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { FaYoutube } from "react-icons/fa";
import { toast } from "sonner";
import * as z from "zod";
import { PlatformConnectionCard } from "@/components/auth/PlatformConnectionCard";
import { LLMProviderFields } from "@/components/llm/LLMProviderFields";
import { formatErrorMessage } from "@/utils";
import logo from "/logos/SQ-YakShaver-LogoIcon-Red.svg?url";
import cpu from "/onboarding/cpu.svg?url";
import monitorPlay from "/onboarding/monitor-play.svg?url";
import {
  ONBOARDING_COMPLETED_KEY,
  ONBOARDING_FINISHED_EVENT,
} from "../../constants/onboarding";
import { useYouTubeAuth } from "../../contexts/YouTubeAuthContext";
import { useCountdown } from "../../hooks/useCountdown";
import { ipcClient } from "../../services/ipc-client";
import type { HealthStatusInfo } from "../../types";
import { AuthStatus } from "../../types";
import { McpSettingsPanel } from "../settings/mcp/McpServerManager";
import { Button } from "../ui/button";
import { Form } from "../ui/form";
import { ScrollArea } from "../ui/scroll-area";
import { MCPServerConfig, MCPServerFormData } from "../settings/mcp/McpServerForm";

type LLMProvider = "openai" | "deepseek";

const llmSchema = z.discriminatedUnion("provider", [
  z.object({
    provider: z.literal("openai"),
    apiKey: z.string().min(1, "API key is required"),
  }),
  z.object({
    provider: z.literal("deepseek"),
    apiKey: z.string().min(1, "API key is required"),
  }),
]);

type LLMFormValues = z.infer<typeof llmSchema>;

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
    description: "Sign in and Authorise YakShaver to publish videos for you.",
  },
  {
    id: 2,
    icon: cpu,
    title: "Connecting an LLM",
    description: "Choose your provider and save the API details",
  },
  {
    id: 3,
    icon: monitorPlay,
    title: "Connecting an MCP",
    description: "Choose or configure which MCP server YakShaver will call.",
  },
];

const LLM_PROVIDER_OPTIONS = [
  { value: "openai", label: "OpenAI" },
  { value: "deepseek", label: "DeepSeek" },
];

export function OnboardingWizard() {
  const [currentStep, setCurrentStep] = useState(1);

  const [isMcpFormOpen, setIsMcpFormOpen] = useState(false);
  const [hasEnabledMcpServers, setHasEnabledMcpServers] = useState(false);
  const [hasYouTubeConfig] = useState(true);
  const [hasLLMConfig, setHasLLMConfig] = useState(false);
  const [isLLMSaving, setIsLLMSaving] = useState(false);
  const [healthStatus, setHealthStatus] = useState<HealthStatusInfo | null>(
    null
  );
  const [_hasMCPConfig, setHasMCPConfig] = useState(false);
  const [isMCPSaving, setIsMCPSaving] = useState(false);
  const [isVisible, setIsVisible] = useState(() => {
    // Check if user has completed onboarding before
    const completed = localStorage.getItem(ONBOARDING_COMPLETED_KEY);
    return completed !== "true";
  });
  const stepListRef = useRef<HTMLDivElement | null>(null);
  const stepIconRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [connectorPositions, setConnectorPositions] = useState<
    ConnectorPosition[]
  >([]);

  const llmForm = useForm<LLMFormValues>({
    resolver: zodResolver(llmSchema),
    defaultValues: {
      provider: "openai",
      apiKey: "",
    },
  });

  const { authState, startAuth, disconnect } = useYouTubeAuth();
  const {
    countdown,
    isActive: isConnecting,
    start: startCountdown,
    reset: resetCountdown,
  } = useCountdown({
    initialSeconds: 60,
  });

  const { status, userInfo } = authState;
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
        const left =
          currentRect.left - containerRect.left + currentRect.width / 2 - 0.5;

        if (height > 0) {
          positions.push({ top, height, left });
        }
      }

      setConnectorPositions(positions);
    });
  }, []);

  // Reset countdown when user successfully connects
  useEffect(() => {
    if (isConnected) {
      resetCountdown();
    }
  }, [isConnected, resetCountdown]);

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
    const checkLLMConfig = async () => {
      try {
        const cfg = await ipcClient.llm.getConfig();
        setHasLLMConfig(!!cfg);
        if (cfg) {
          llmForm.reset(cfg as LLMFormValues);

          // If there's a config with API key, validate it
          if (cfg.apiKey) {
            setIsLLMSaving(true);
            setHealthStatus({
              isHealthy: false,
              isChecking: true,
            });

            try {
              const healthResult = await ipcClient.llm.checkHealth();

              if (!healthResult.isHealthy) {
                setHealthStatus({
                  isHealthy: false,
                  isChecking: false,
                  error:
                    healthResult.error || "Failed to connect to LLM provider",
                });
                setHasLLMConfig(false);
              } else {
                setHealthStatus({
                  isHealthy: true,
                  isChecking: false,
                  successMessage:
                    healthResult.successMessage ||
                    "API key validated successfully",
                });
                setHasLLMConfig(true);
              }
            } catch (e) {
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
        }
      } catch (_error) {
        setHasLLMConfig(false);
      }
    };

    if (currentStep === 2) {
      void checkLLMConfig();
    }
  }, [currentStep, llmForm]);

  const handleLLMSubmit = useCallback(async (values: LLMFormValues) => {
    setIsLLMSaving(true);
    try {
      await ipcClient.llm.setConfig(values as LLMConfig);
      toast.success(
        values.provider === "openai"
          ? "OpenAI configuration saved"
          : "DeepSeek configuration saved"
      );
      setHasLLMConfig(true);
    } catch (e) {
      toast.error(`Failed to save configuration: ${formatErrorMessage(e)}`);
    } finally {
      setIsLLMSaving(false);
    }
  }, []);

  const handleProviderChange = (value: LLMProvider) => {
    llmForm.reset({
      provider: value,
      apiKey: "",
    } as LLMFormValues);
    setHealthStatus(null);
  };

  // const saveMcpConfig = useCallback(
  //   async (values: MCPServerFormData) => {
  //     setIsMCPSaving(true);

  //     let headers: Record<string, string> | undefined;
  //     if (values.headers?.trim()) {
  //       try {
  //         const parsedHeaders = JSON.parse(values.headers);
  //         if (
  //           !parsedHeaders ||
  //           typeof parsedHeaders !== "object" ||
  //           Array.isArray(parsedHeaders) ||
  //           !Object.entries(parsedHeaders).every(
  //             ([, value]) => typeof value === "string"
  //           )
  //         ) {
  //           throw new Error("Headers must be a JSON object with string values");
  //         }
  //         headers = parsedHeaders as Record<string, string>;
  //       } catch (error) {
  //         const message =
  //           error instanceof Error
  //             ? error.message
  //             : "Headers must be a JSON object with string values";
  //         mcpForm.setError("headers", { message });
  //         toast.error(message);
  //         setIsMCPSaving(false);
  //         return false;
  //       }
  //     }

  //     const config: MCPServerConfig = {
  //       name: values.name.trim(),
  //       transport: "streamableHttp",
  //       url: (values.url ?? "").trim(),
  //       description: values.description?.trim() || undefined,
  //       headers,
  //       version: values.version?.trim() || undefined,
  //       timeoutMs:
  //         typeof values.timeoutMs === "number" ? values.timeoutMs : undefined,
  //     };

  //     try {
  //       await ipcClient.mcp.addServerAsync(config);
  //       toast.success(`MCP server '${config.name}' saved`);
  //       setHasMCPConfig(true);
  //       return true;
  //     } catch (error) {
  //       toast.error(`Failed to save MCP server: ${formatErrorMessage(error)}`);
  //       return false;
  //     } finally {
  //       setIsMCPSaving(false);
  //     }
  //   },
  //   [mcpForm]
  // );

  // Auto-validate API key on input change
  useEffect(() => {
    const subscription = llmForm.watch(async (value, { name }) => {
      if (name === "apiKey" && value.apiKey && value.apiKey.length > 10) {
        // Debounce the validation
        const timeoutId = setTimeout(async () => {
          setIsLLMSaving(true);
          setHealthStatus({
            isHealthy: false,
            isChecking: true,
          });

          try {
            const values = llmForm.getValues();
            await ipcClient.llm.setConfig(values as LLMConfig);
            const healthResult = await ipcClient.llm.checkHealth();

            if (!healthResult.isHealthy) {
              setHealthStatus({
                isHealthy: false,
                isChecking: false,
                error:
                  healthResult.error || "Failed to connect to LLM provider",
              });
              setHasLLMConfig(false);
            } else {
              setHealthStatus({
                isHealthy: true,
                isChecking: false,
                successMessage:
                  healthResult.successMessage ||
                  "API key validated successfully",
              });
              setHasLLMConfig(true);
            }
          } catch (e) {
            setHealthStatus({
              isHealthy: false,
              isChecking: false,
              error: formatErrorMessage(e),
            });
            setHasLLMConfig(false);
          } finally {
            setIsLLMSaving(false);
          }
        }, 500); // 500ms debounce

        return () => clearTimeout(timeoutId);
      } else if (name === "apiKey") {
        setHealthStatus(null);
        setHasLLMConfig(false);
      }
    });

    return () => subscription.unsubscribe();
  }, [llmForm]);

  const completeOnboarding = useCallback(() => {
    localStorage.setItem(ONBOARDING_COMPLETED_KEY, "true");
    window.dispatchEvent(new CustomEvent(ONBOARDING_FINISHED_EVENT));
    setIsVisible(false);
  }, []);

  const handleStep2Next = useCallback(async () => {
    const isValid = await llmForm.trigger();
    if (!isValid) return false;

    if (!hasLLMConfig || !healthStatus?.isHealthy) {
      toast.error("Please enter a valid API key before proceeding");
      return false;
    }

    toast.success(
      llmForm.getValues().provider === "openai"
        ? "OpenAI configuration saved"
        : "DeepSeek configuration saved"
    );
    setCurrentStep(3);
    return true;
  }, [hasLLMConfig, healthStatus?.isHealthy, llmForm]);

  const handleStep3Next = useCallback(async () => {
    completeOnboarding();
    return true;
  }, [completeOnboarding]);

  const handleNext = async () => {
    if (currentStep === 2) {
      await handleStep2Next();
      return;
    }

    if (currentStep === 3) {
      await handleStep3Next();
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

  const handleYouTubeAction = async () => {
    if (isConnected) {
      await disconnect();
    } else {
      startCountdown();
      try {
        await startAuth();
      } finally {
        resetCountdown();
      }
    }
  };

  const getYouTubeButtonText = () => {
    if (isConnected) return "Disconnect";
    if (isConnecting) return `Connecting... (${countdown}s)`;
    return "Connect";
  };

  const getStepStatus = (step: number) => {
    if (step < currentStep) return "completed";
    if (step === currentStep) return "current";
    return "pending";
  };

  // const isMcpFormIncomplete = !watchedMcpName?.trim() || !watchedMcpUrl?.trim();

  const isNextDisabled =
    (currentStep === 1 && !isConnected) ||
    (currentStep === 2 && isLLMSaving) ||
    (currentStep === 3 && !hasEnabledMcpServers);

  if (!isVisible) return null;

  const rightPanelContent = (
    <div className={`flex flex-col w-full`}>
      {/* Step indicator */}
      <div className="px-6">
        <p className="text-sm font-medium leading-6 text-white">
          Step {currentStep} of {STEPS.length}
        </p>
      </div>

      {/* Card header */}
      <div className="flex flex-col gap-1.5 p-6 w-full">
        <div className="flex ">
          <p className="text-2xl font-semibold leading-6 tracking-[-0.015em] text-white/[0.98]">
            {STEPS[currentStep - 1].title}
          </p>
        </div>
        <div className="flex w-full">
          <p className="text-sm font-normal leading-5 text-white/[0.56]">
            {currentStep === 1
              ? "Choose a platform to host your videos."
              : currentStep === 2
                ? "Choose your provider and save the API details"
                : "Configure or choose which MCP server YakShaver will call."}
          </p>
        </div>
      </div>

      {/* Card content */}
      <div className="flex flex-col gap-4 px-6 pb-6 w-full">
        {currentStep === 1 &&
          (hasYouTubeConfig ? (
            <PlatformConnectionCard
              icon={<FaYoutube className="w-10 h-10 text-ssw-red text-2xl" />}
              title="YouTube"
              subtitle={
                isConnected && userInfo?.channelName
                  ? userInfo.channelName
                  : undefined
              }
              badgeText={isConnected ? "Connected" : undefined}
              onAction={handleYouTubeAction}
              actionLabel={getYouTubeButtonText()}
              actionDisabled={isConnecting && !isConnected}
              buttonSize="lg"
            />
          ) : (
            <div className="text-center py-8 px-4 text-white/[0.56]">
              <p className="mb-2 text-sm">No platforms available</p>
              <p className="text-xs italic">
                Configure YouTube API credentials to get started
              </p>
            </div>
          ))}

        {currentStep === 2 && (
          <div className="w-full">
            <Form {...llmForm}>
              <form
                onSubmit={llmForm.handleSubmit(handleLLMSubmit)}
                className="flex flex-col gap-4"
              >
                <LLMProviderFields
                  control={llmForm.control}
                  providerField="provider"
                  apiKeyField="apiKey"
                  providerOptions={LLM_PROVIDER_OPTIONS}
                  onProviderChange={(value) =>
                    handleProviderChange(value as LLMProvider)
                  }
                  healthStatus={healthStatus}
                  selectContentClassName="z-[70]"
                />
              </form>
            </Form>
          </div>
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
        <div className="flex h-16 items-center justify-end px-6 pb-6 w-full">
          <div
            className={`flex items-center w-full ${currentStep > 1 ? "justify-between" : "justify-end"
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
    </div>);

  return (
    <div className="fixed inset-0 z-[40] flex items-center justify-center">
      <div className="fixed inset-0 bg-[url('/background/YakShaver-Background.jpg')] bg-cover bg-center bg-no-repeat"></div>

      <div className="relative flex w-full max-w-[1295px] h-[840px] bg-black/[0.44] border border-white/[0.24] rounded-lg shadow-sm p-2.5 gap-10">
        <div className="hidden md:flex flex-col md:w-[360px] lg:w-[440px] xl:w-[480px] h-full bg-[#1C0D05] rounded-md px-5 py-10">
          {/* Logo */}
          <div className="w-full">
            <div className="flex items-center ml-10">
              <img src={logo} alt="YakShaver" className="w-18 h-auto pr-2.5" />
              <span className="text-3xl font-bold text-ssw-red">Yak</span>
              <span className="text-3xl">Shaver</span>
            </div>
          </div>

          <div className="flex mt-25 justify-center flex-1">
            <div ref={stepListRef} className="relative flex gap-10 flex-col ">
              {connectorPositions.map((position, index) => {
                const nextStep = STEPS[index + 1];
                if (!nextStep) return null;

                const status = getStepStatus(nextStep.id);

                return (
                  <div
                    key={`connector-${nextStep.id}`}
                    className={`absolute w-px transition-colors duration-300 ${status === "pending" ? "bg-[#432A1D]" : "bg-[#75594B]"
                      }`}
                    style={{
                      left: position.left,
                      top: position.top,
                      height: position.height,
                    }}
                  ></div>
                );
              })}

              {STEPS.map((step, index) => (
                <div key={step.id} className="flex gap-8">
                  <div className="flex flex-col items-center">
                    <div
                      ref={(element) => {
                        stepIconRefs.current[index] = element;
                      }}
                      className={`w-10 h-10 rounded-full flex items-center justify-center transition-colors duration-300 ${getStepStatus(step.id) === "pending"
                        ? "bg-[#432A1D]"
                        : "bg-[#75594B]"
                        }`}
                    >
                      <img
                        src={step.icon}
                        alt={step.title}
                        className={`w-6 h-6 transition-opacity duration-300 ${getStepStatus(step.id) === "pending"
                          ? "opacity-40"
                          : "opacity-100"
                          }`}
                      />
                    </div>
                  </div>

                  <div className="flex flex-col justify-center w-[219px]">
                    <p
                      className={`text-sm font-medium leading-5 transition-opacity duration-300 ${getStepStatus(step.id) === "pending"
                        ? "text-white/[0.56]"
                        : "text-white/[0.98]"
                        }`}
                    >
                      {step.title}
                    </p>
                    <p className="text-sm font-normal leading-5 text-white/[0.76]">
                      {step.description}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="flex flex-col flex-1 min-w-0 h-full">
          {currentStep === 3 /* && isMcpAdvancedOpen */ ? (
            <ScrollArea className="w-full h-full">
              <div className="flex flex-col px-20 py-40">
                {rightPanelContent}
              </div>
            </ScrollArea>
          ) : (
            <div className="flex flex-col w-full px-20 py-40">
              {rightPanelContent}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
