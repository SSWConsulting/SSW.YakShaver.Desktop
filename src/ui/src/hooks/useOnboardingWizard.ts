import { useCallback, useEffect, useRef, useState } from "react";
import type { ConnectorPosition, StepStatus } from "@/types/onboarding";
import { STEPS } from "@/types/onboarding";
import { ONBOARDING_COMPLETED_KEY, ONBOARDING_FINISHED_EVENT } from "../constants/onboarding";

interface UseOnboardingWizardProps {
  onVisibilityChange?: (isVisible: boolean) => void;
}

export function useOnboardingWizard({ onVisibilityChange }: UseOnboardingWizardProps) {
  const [currentStep, setCurrentStep] = useState(1);
  const [isVisible, setIsVisible] = useState(() => {
    const completed = localStorage.getItem(ONBOARDING_COMPLETED_KEY);
    return completed !== "true";
  });

  const stepListRef = useRef<HTMLDivElement | null>(null);
  const stepIconRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [connectorPositions, setConnectorPositions] = useState<ConnectorPosition[]>([]);

  useEffect(() => {
    onVisibilityChange?.(isVisible);
  }, [isVisible, onVisibilityChange]);

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
    if (!isVisible) return;
    updateConnectorPositions();
  }, [isVisible, updateConnectorPositions]);

  useEffect(() => {
    window.addEventListener("resize", updateConnectorPositions);
    return () => {
      window.removeEventListener("resize", updateConnectorPositions);
    };
  }, [updateConnectorPositions]);

  const completeOnboarding = useCallback(() => {
    localStorage.setItem(ONBOARDING_COMPLETED_KEY, "true");
    window.dispatchEvent(new CustomEvent(ONBOARDING_FINISHED_EVENT));
    setIsVisible(false);
  }, []);

  const getSidebarStepStatus = useCallback(
    (sidebarStep: (typeof STEPS)[number]): StepStatus => {
      const navSteps = sidebarStep.navSteps;
      if (navSteps.some((s) => s === currentStep)) return "current";
      if (navSteps.every((s) => s < currentStep)) return "completed";
      return "pending";
    },
    [currentStep],
  );

  const goToNextStep = useCallback(() => {
    if (currentStep < STEPS.length) {
      setCurrentStep((step) => step + 1);
    }
  }, [currentStep]);

  const goToPreviousStep = useCallback(() => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1);
    }
  }, [currentStep]);

  return {
    currentStep,
    isVisible,
    connectorPositions,
    stepListRef,
    stepIconRefs,
    getSidebarStepStatus,
    goToNextStep,
    goToPreviousStep,
    completeOnboarding,
  };
}
