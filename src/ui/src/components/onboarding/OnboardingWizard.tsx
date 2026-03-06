import { type ReactNode, useState } from "react";
import { toast } from "sonner";
import { LLM_STEP_ID, MCP_STEP_ID, STEPS, VIDEO_STEP_ID } from "@/types/onboarding";
import { ONBOARDING_COMPLETED_KEY } from "../../constants/onboarding";
import { useOnboardingWizard } from "../../hooks/useOnboardingWizard";
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

interface StepLayoutWrapperProps {
  currentStep: number;
  children: ReactNode;
}

function StepLayoutWrapper({ currentStep, children }: StepLayoutWrapperProps) {
  if (currentStep === LLM_STEP_ID) {
    return (
      <div className="flex flex-col items-center justify-center w-full h-full px-20 py-10">
        {children}
      </div>
    );
  }

  if (currentStep === MCP_STEP_ID) {
    return (
      <ScrollArea className="w-full h-full">
        <div className="flex flex-col px-20 py-40">{children}</div>
      </ScrollArea>
    );
  }

  return <div className="flex flex-col w-full px-20 py-40">{children}</div>;
}

export function OnboardingWizard({ onVisibilityChange }: OnboardingWizardProps) {
  const [isMcpFormOpen, setIsMcpFormOpen] = useState(false);
  const wizard = useOnboardingWizard({ onVisibilityChange });

  const handleNext = async () => {
    if (wizard.currentStep === LLM_STEP_ID) {
      toast.success("LLM configuration saved");
    }

    if (wizard.currentStep === STEPS.length) {
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
        {wizard.currentStep === VIDEO_STEP_ID && (
          <VideoHostingStep onValidationChange={wizard.setIsNextEnabled} />
        )}
        {wizard.currentStep === LLM_STEP_ID && (
          <LLMStep onValidationChange={wizard.setIsNextEnabled} />
        )}
        {wizard.currentStep === MCP_STEP_ID && (
          <MCPStep
            onFormOpenChange={setIsMcpFormOpen}
            onValidationChange={wizard.setIsNextEnabled}
          />
        )}
      </div>

      {/* Card footer */}
      {!isMcpFormOpen && (
        <StepFooter
          currentStep={wizard.currentStep}
          isNextDisabled={!wizard.isNextEnabled}
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
          <StepLayoutWrapper currentStep={wizard.currentStep}>
            {rightPanelContent}
          </StepLayoutWrapper>
        </div>
      </div>
    </div>
  );
}
