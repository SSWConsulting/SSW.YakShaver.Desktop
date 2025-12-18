import { zodResolver } from "@hookform/resolvers/zod";
import { useCallback, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { FaYoutube } from "react-icons/fa";
import { toast } from "sonner";
import * as z from "zod";
import { Badge } from "@/components/ui/badge";
import { formatErrorMessage } from "@/utils";
import { useYouTubeAuth } from "../../contexts/YouTubeAuthContext";
import { useCountdown } from "../../hooks/useCountdown";
import { ipcClient } from "../../services/ipc-client";
import type { HealthStatusInfo, LLMConfig } from "../../types";
import { AuthStatus } from "../../types";
import { HealthStatus } from "../health-status/health-status";
import { Button } from "../ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "../ui/form";
import { Input } from "../ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";

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

const ONBOARDING_COMPLETED_KEY = "hasCompletedOnboarding";

// Utility function to reset onboarding (can be called from settings)
export const resetOnboarding = () => {
  localStorage.removeItem(ONBOARDING_COMPLETED_KEY);
};

const STEPS = [
  {
    id: 1,
    icon: "/onboarding/monitor-play.svg",
    title: "Video Hosting",
    description: "Sign in and Authorise YakShaver to publish videos for you.",
  },
  {
    id: 2,
    icon: "/onboarding/cpu.svg",
    title: "Connecting an LLM",
    description: "Choose your provider and save the API details",
  },
  {
    id: 3,
    icon: "/onboarding/monitor-play.svg",
    title: "Connecting an MCP",
    description: "Configure or choose which MCP server YakShaver will call.",
  },
  {
    id: 4,
    icon: "/onboarding/play.svg",
    title: "Record your first Video",
    description: "Finish setup and jump into your first request.",
  },
];

export function OnboardingWizard() {
  const [currentStep, setCurrentStep] = useState(1);
  const [hasYouTubeConfig] = useState(true); // TODO: Get from settings/config
  const [hasLLMConfig, setHasLLMConfig] = useState(false);
  const [isLLMSaving, setIsLLMSaving] = useState(false);
  const [healthStatus, setHealthStatus] = useState<HealthStatusInfo | null>(null);
  const [isVisible, setIsVisible] = useState(() => {
    // Check if user has completed onboarding before
    const completed = localStorage.getItem(ONBOARDING_COMPLETED_KEY);
    return completed !== "true";
  });

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

  // Reset countdown when user successfully connects
  useEffect(() => {
    if (isConnected) {
      resetCountdown();
    }
  }, [isConnected, resetCountdown]);

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
          : "DeepSeek configuration saved",
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

            // Save the configuration first
            await ipcClient.llm.setConfig(values as LLMConfig);

            // Then check health to validate the API key
            const healthResult = await ipcClient.llm.checkHealth();

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
        // Reset health status if API key is too short
        setHealthStatus(null);
        setHasLLMConfig(false);
      }
    });

    return () => subscription.unsubscribe();
  }, [llmForm]);

  const handleNext = async () => {
    if (currentStep === 2) {
      // For step 2, check if LLM config is valid
      const isValid = await llmForm.trigger();
      if (!isValid) return;

      if (!hasLLMConfig || !healthStatus?.isHealthy) {
        toast.error("Please enter a valid API key before proceeding");
        return;
      }

      toast.success(
        llmForm.getValues().provider === "openai"
          ? "OpenAI configuration saved"
          : "DeepSeek configuration saved",
      );
      setCurrentStep(currentStep + 1);
    } else if (currentStep < 4) {
      setCurrentStep(currentStep + 1);
    } else {
      // User completed all steps
      localStorage.setItem(ONBOARDING_COMPLETED_KEY, "true");
      setIsVisible(false);
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

  const handleSkip = () => {
    if (currentStep < 4) {
      setCurrentStep(currentStep + 1);
    } else {
      localStorage.setItem(ONBOARDING_COMPLETED_KEY, "true");
      setIsVisible(false);
    }
  };

  if (!isVisible) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center">
      <div className="fixed inset-0 bg-[url('/background/YakShaver-Background.jpg')] bg-cover bg-center bg-no-repeat"></div>

      <div className="relative flex w-full max-w-[1295px] h-[840px] bg-black/[0.44] border border-white/[0.24] rounded-lg shadow-sm p-2.5 gap-10">
        {/* Left Sidebar */}
        <div className="flex flex-col w-[440px] h-full bg-[#1C0D05] rounded-md px-5 py-10">
          {/* Logo */}
          <div className="w-full">
            <div className="flex items-center">
              <img
                src="/logos/SQ-YakShaver-LogoIcon-Red.svg"
                alt="YakShaver"
                className="w-18 h-auto pr-2.5"
              />
              <span className="text-3xl font-bold text-ssw-red">Yak</span>
              <span className="text-3xl">Shaver</span>
            </div>
          </div>

          <div className="flex gap-8 items-center justify-center flex-1">
            {/* Timeline and Icons */}
            <div className="flex flex-row items-center">
              <div className="relative flex flex-col items-center justify-between w-[41px] h-full">
                {/* Progress lines */}
                <div className="absolute w-px h-full bg-[#432A1D] left-1/2 top-0 -translate-x-1/2" />
                <div
                  className="absolute w-px bg-[#75594B] left-1/2 top-0 -translate-x-1/2 transition-all duration-300"
                  style={{
                    height:
                      currentStep === 1
                        ? "0%"
                        : currentStep === 2
                          ? "33%"
                          : currentStep === 3
                            ? "66%"
                            : "100%",
                  }}
                />

                {/* Step Icons */}
                <div className="flex flex-col items-center gap-[60px] relative z-10">
                  {STEPS.map((step, index) => (
                    <div
                      key={step.id}
                      className={`flex flex-col items-center gap-2 ${index < STEPS.length - 1 ? "h-[60px]" : ""}`}
                    >
                      <div
                        className={`w-10 h-10 rounded-full flex items-center justify-center transition-colors duration-300 ${
                          getStepStatus(step.id) === "pending" ? "bg-[#432A1D]" : "bg-[#75594B]"
                        }`}
                      >
                        <img
                          src={step.icon}
                          alt={step.title}
                          className={`w-6 h-6 transition-opacity duration-300 ${
                            getStepStatus(step.id) === "pending" ? "opacity-40" : "opacity-100"
                          }`}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Step Labels */}
            <div className="flex flex-col gap-[60px] w-[219px]">
              {STEPS.map((step) => (
                <div key={step.id} className="flex items-center w-[200px]">
                  <div className="flex flex-col justify-center">
                    <p
                      className={`text-sm font-medium leading-5 transition-opacity duration-300 ${
                        getStepStatus(step.id) === "pending"
                          ? "text-white/[0.56]"
                          : "text-white/[0.98]"
                      }`}
                    >
                      {step.title}
                    </p>
                    <p className="text-sm font-normal leading-5 text-white/[0.56]">
                      {step.description}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right Content Area */}
        <div className="flex flex-col w-[759px] px-20 py-40">
          <div className="flex flex-col h-[330px] w-full">
            {/* Step indicator */}
            <div className="px-6">
              <p className="text-sm font-medium leading-6 text-white">Step {currentStep} of 4</p>
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
                      : currentStep === 3
                        ? "Configure or choose which MCP server YakShaver will call."
                        : "Finish setup and jump into your first request."}
                </p>
              </div>
            </div>

            {/* Card content */}
            <div className="flex flex-col gap-4 px-6 pb-6 w-full">
              {currentStep === 1 &&
                (hasYouTubeConfig ? (
                  <div className="flex items-center justify-between px-6 py-4 bg-white/[0.04] border border-white/[0.24] rounded-lg w-full">
                    <div className="flex items-center gap-4">
                      <FaYoutube className="w-10 h-10 text-ssw-red text-2xl" />
                      <div>
                        <p className="text-sm font-medium leading-6 text-white">YouTube</p>
                        {isConnected && userInfo && (
                          <p className="text-xs text-white/[0.56] font-medium">{userInfo.name}</p>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-4">
                      {isConnected && <Badge variant="success">Connected</Badge>}
                      <Button
                        size="lg"
                        onClick={handleYouTubeAction}
                        disabled={isConnecting && !isConnected}
                      >
                        {getYouTubeButtonText()}
                      </Button>
                    </div>
                  </div>
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
                      {/* Provider Dropdown */}
                      <FormField
                        control={llmForm.control}
                        name="provider"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-white">Provider</FormLabel>
                            <Select
                              onValueChange={(v: LLMProvider) => {
                                field.onChange(v);
                                handleProviderChange(v);
                              }}
                              value={field.value}
                            >
                              <FormControl>
                                <SelectTrigger className="cursor-pointer">
                                  <SelectValue placeholder="Select provider" />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent className="z-[70]">
                                <SelectItem value="openai">OpenAI</SelectItem>
                                <SelectItem value="deepseek">DeepSeek</SelectItem>
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      {/* API Key Input */}
                      <FormField
                        control={llmForm.control}
                        name="apiKey"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-white">API Key</FormLabel>
                            <div className="relative">
                              {healthStatus && (
                                <div className="absolute left-3 top-1/2 -translate-y-1/2 z-10">
                                  <HealthStatus
                                    isChecking={healthStatus.isChecking ?? false}
                                    isHealthy={healthStatus.isHealthy ?? false}
                                    successMessage={healthStatus.successMessage}
                                    error={healthStatus.error}
                                  />
                                </div>
                              )}
                              <FormControl>
                                <Input
                                  {...field}
                                  placeholder="sk-..."
                                  type="password"
                                  className={healthStatus ? "pl-10" : ""}
                                />
                              </FormControl>
                            </div>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </form>
                  </Form>
                </div>
              )}

              {currentStep === 3 && (
                <div className="text-center py-8 px-4 text-white/[0.56]">
                  <p className="mb-2 text-sm">MCP Configuration</p>
                  <p className="text-xs italic">Coming soon...</p>
                </div>
              )}

              {currentStep === 4 && (
                <div className="text-center py-8 px-4 text-white/[0.56]">
                  <p className="mb-2 text-sm">You're all set!</p>
                  <p className="text-xs italic">Click Finish to start recording.</p>
                </div>
              )}
            </div>

            {/* Card footer */}
            <div className="flex h-16 items-start justify-end px-6 pb-6 w-full">
              <div className="flex items-center justify-between w-full">
                <Button
                  className="flex items-center justify-center px-4 py-2"
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={handleSkip}
                >
                  Skip for now
                </Button>

                <div className="flex gap-2 h-10">
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
                    disabled={
                      (currentStep === 1 && !isConnected) || (currentStep === 2 && isLLMSaving)
                    }
                  >
                    {currentStep === 2 && isLLMSaving
                      ? "Checking..."
                      : currentStep === 4
                        ? "Finish"
                        : "Next"}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
