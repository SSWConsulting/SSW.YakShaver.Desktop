import { ChevronRight } from "lucide-react";
import { STEPS } from "@/types/onboarding";
import { Button } from "../ui/button";

interface StepFooterProps {
  currentStep: number;
  isNextDisabled: boolean;
  onNext: () => void;
  onPrevious: () => void;
}

export function StepFooter({ currentStep, isNextDisabled, onNext, onPrevious }: StepFooterProps) {
  const getButtonLabel = () => {
    if (currentStep === STEPS.length) return "Finish";
    return "Next";
  };

  return (
    <div className="flex h-16 w-full items-center justify-end px-6">
      <div
        className={`flex w-full items-center ${
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
            {"< Previous"}
          </Button>
        )}

        <Button
          className="flex items-center justify-center px-4 py-2"
          size="sm"
          type="button"
          onClick={onNext}
          disabled={isNextDisabled}
        >
          <span>{getButtonLabel()}</span>
          {currentStep < STEPS.length && <ChevronRight className="size-4" aria-hidden="true" />}
        </Button>
      </div>
    </div>
  );
}
