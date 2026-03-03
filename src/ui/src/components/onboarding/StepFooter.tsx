import { LLM_STEP_ID, STEPS } from "@/types/onboarding";
import { Button } from "../ui/button";

interface StepFooterProps {
  currentStep: number;
  isNextDisabled: boolean;
  isLLMSaving: boolean;
  onNext: () => void;
  onPrevious: () => void;
}

export function StepFooter({
  currentStep,
  isNextDisabled,
  isLLMSaving,
  onNext,
  onPrevious,
}: StepFooterProps) {
  const getButtonLabel = () => {
    if (currentStep === LLM_STEP_ID && isLLMSaving) return "Checking...";
    if (currentStep === STEPS.length) return "Finish";
    return "Next";
  };

  return (
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
            onClick={onPrevious}
          >
            Previous
          </Button>
        )}

        <Button
          className="flex items-center justify-center px-4 py-2"
          size="sm"
          type="button"
          onClick={onNext}
          disabled={isNextDisabled}
        >
          {getButtonLabel()}
        </Button>
      </div>
    </div>
  );
}
