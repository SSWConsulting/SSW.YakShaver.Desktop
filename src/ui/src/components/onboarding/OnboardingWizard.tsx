import { useState } from "react";
import { toast } from "sonner";
import { LLM_STEP_ID, MCP_STEP_ID, STEPS } from "@/types/onboarding";
import { ONBOARDING_COMPLETED_KEY } from "../../constants/onboarding";
import { useYouTubeAuth } from "../../contexts/YouTubeAuthContext";
import { useOnboardingLLM } from "../../hooks/useOnboardingLLM";
import { useOnboardingWizard } from "../../hooks/useOnboardingWizard";
import { AuthStatus } from "../../types";
import { ScrollArea } from "../ui/scroll-area";
import { LLMStep } from "./LLMStep";
import { MCPStep } from "./MCPStep";
import { OnboardingSidebar } from "./OnboardingSidebar";
import { StepFooter } from "./StepFooter";
import { VideoHostingStep } from "./VideoHostingStep";

interface OnboardingWizardProps {
  onVisibilityChange?: (isVisible: boolean) => void;
}

// Utility function to reset onboarding (can be called from settings)
export const resetOnboarding = () => {
  if (typeof window === "undefined") {
    return;
  }
  localStorage.removeItem(ONBOARDING_COMPLETED_KEY);
};

export function OnboardingWizard({ onVisibilityChange }: OnboardingWizardProps) {
  const [isMcpFormOpen, setIsMcpFormOpen] = useState(false);
  const [hasEnabledMcpServers, setHasEnabledMcpServers] = useState(false);

  const wizard = useOnboardingWizard({ onVisibilityChange });
  const llm = useOnboardingLLM(wizard.currentStep);

  const { authState } = useYouTubeAuth();
  const isConnected = authState.status === AuthStatus.AUTHENTICATED;

  const isNextDisabled =
    (wizard.currentStep === 1 && !isConnected) ||
    (wizard.currentStep === LLM_STEP_ID &&
      (llm.isLLMSaving ||
        !llm.hasLLMConfig ||
        !llm.healthStatus?.isHealthy ||
        !llm.hasTranscriptionConfig)) ||
    (wizard.currentStep === MCP_STEP_ID && !hasEnabledMcpServers);

  const handleNext = async () => {
    if (wizard.currentStep === LLM_STEP_ID) {
      const isValid = await llm.llmForm.trigger();
      if (!isValid) return;

      if (!llm.hasLLMConfig || !llm.healthStatus?.isHealthy) {
        toast.error("Please enter a valid API key before proceeding");
        return;
      }

      if (!llm.hasTranscriptionConfig) {
        toast.error("Please configure a transcription model before proceeding");
        return;
      }

      toast.success("LLM configuration saved");
      wizard.goToNextStep();
      return;
    }

    if (wizard.currentStep === MCP_STEP_ID) {
      wizard.completeOnboarding();
      return;
    }

    wizard.goToNextStep();
  };

  if (!wizard.isVisible) return null;

  const currentStepData = STEPS[wizard.currentStep - 1];

  const rightPanelContent = (
    <div className="flex flex-col w-full max-w-[599px]">
      {/* Step indicator */}
      <div className="px-6">
        <p className="text-sm font-medium leading-6 text-white">
          Step {wizard.currentStep} of {STEPS.length}
        </p>
      </div>

      {/* Card header */}
      <div className="flex flex-col gap-1.5 p-6 w-full">
        <p className="text-2xl font-semibold leading-6 tracking-[-0.015em] text-white/[0.98]">
          {currentStepData.title}
        </p>
        <p className="text-sm font-normal leading-5 text-white/[0.56]">
          {currentStepData.description}
        </p>
      </div>

      {/* Card content */}
      <div className="flex flex-col gap-6 px-6 pb-6 w-full">
        {wizard.currentStep === 1 && <VideoHostingStep />}
        {wizard.currentStep === LLM_STEP_ID && <LLMStep llmState={llm} />}
        {wizard.currentStep === MCP_STEP_ID && (
          <MCPStep
            onFormOpenChange={setIsMcpFormOpen}
            onHasEnabledServers={setHasEnabledMcpServers}
          />
        )}
      </div>

      {/* Card footer */}
      {!isMcpFormOpen && (
        <StepFooter
          currentStep={wizard.currentStep}
          isNextDisabled={isNextDisabled}
          isLLMSaving={llm.isLLMSaving}
          onNext={handleNext}
          onPrevious={wizard.goToPreviousStep}
        />
      )}
    </div>
  );

  return (
    <div className="fixed inset-0 z-[40] flex items-center justify-center">
      <div className="fixed inset-0 bg-[url('/background/YakShaver-Background.jpg')] bg-cover bg-center bg-no-repeat" />

      <div className="relative flex w-full max-w-[1295px] h-[840px] bg-black/[0.44] border border-white/[0.24] rounded-lg shadow-sm p-2.5 gap-10">
        <OnboardingSidebar
          connectorPositions={wizard.connectorPositions}
          stepListRef={wizard.stepListRef}
          stepIconRefs={wizard.stepIconRefs}
          getSidebarStepStatus={wizard.getSidebarStepStatus}
        />
        <div className="flex flex-col flex-1 min-w-0 h-full">
          {wizard.currentStep === 2 ? (
            <div className="flex flex-col items-center justify-center w-full h-full px-20 py-10">
              {rightPanelContent}
            </div>
          ) : wizard.currentStep === 3 ? (
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
