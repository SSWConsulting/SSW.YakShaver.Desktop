import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { Progress } from "../ui/progress";

const DEFAULT_STORAGE_KEY = "yakshaver:onboardingCompleted";

export interface OnboardingStep {
  id: string;
  title: string;
  description: string;
  tips?: string[];
}

export interface OnboardingWizardProps {
  /**
   * Override the localStorage key used to persist completion.
   */
  storageKey?: string;
  /**
   * Provide custom steps to replace or extend the defaults.
   */
  steps?: OnboardingStep[];
  /**
   * Force the dialog to show even if onboarding was already completed.
   */
  forceShow?: boolean;
  /**
   * Called once the wizard completes or is skipped.
   */
  onDismissed?: () => void;
}

const DEFAULT_STEPS: OnboardingStep[] = [
  {
    id: "record",
    title: "Record or import a video",
    description:
      "Use the red “Start Recording” button to capture your screen, or paste a YouTube link to process an existing video.",
    tips: [
      "Pick the exact display, camera, and microphone you want before recording.",
      "You can retry recordings as many times as you need.",
    ],
  },
  {
    id: "connect",
    title: "Connect your publishing platform",
    description:
      "Authenticate with YouTube (or another host) so YakShaver can upload the final output for you.",
    tips: [
      "Use the Platform selector in the right column to link your account.",
      "Staying signed in keeps future publishing totally frictionless.",
    ],
  },
  {
    id: "review",
    title: "Review workflow progress",
    description:
      "Watch each workflow stage complete, inspect reasoning, and intervene if something looks off.",
    tips: [
      "Cancel or retry any stage before moving forward.",
      "Undo is available for select stages to roll back when necessary.",
    ],
  },
];

function safeGetItem(key: string): string | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSetItem(key: string, value: string | null) {
  if (typeof window === "undefined") {
    return;
  }
  try {
    if (value === null) {
      window.localStorage.removeItem(key);
    } else {
      window.localStorage.setItem(key, value);
    }
  } catch {
    // Ignore storage failures – onboarding will simply reappear.
  }
}

export function hasCompletedOnboarding(storageKey = DEFAULT_STORAGE_KEY): boolean {
  return safeGetItem(storageKey) === "true";
}

export function resetOnboarding(storageKey = DEFAULT_STORAGE_KEY) {
  safeSetItem(storageKey, null);
}

export function OnboardingWizard({
  storageKey = DEFAULT_STORAGE_KEY,
  steps = DEFAULT_STEPS,
  forceShow = false,
  onDismissed,
}: OnboardingWizardProps) {
  const [hasCompleted, setHasCompleted] = useState(() => hasCompletedOnboarding(storageKey));
  const [isOpen, setIsOpen] = useState(() =>
    forceShow ? true : !hasCompleted && steps.length > 0,
  );
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    setHasCompleted(hasCompletedOnboarding(storageKey));
  }, [storageKey]);

  useEffect(() => {
    if (forceShow) {
      setIsOpen(true);
      return;
    }
    setIsOpen(!hasCompleted && steps.length > 0);
  }, [forceShow, hasCompleted, steps.length]);

  const clampedIndex = useMemo(
    () => Math.min(Math.max(activeIndex, 0), Math.max(steps.length - 1, 0)),
    [activeIndex, steps.length],
  );

  const currentStep = steps[clampedIndex];
  const completionPercent =
    steps.length > 0 ? Math.round(((clampedIndex + 1) / steps.length) * 100) : 100;
  const isLastStep = clampedIndex === steps.length - 1;

  const markComplete = useCallback(() => {
    safeSetItem(storageKey, "true");
    setHasCompleted(true);
    onDismissed?.();
  }, [onDismissed, storageKey]);

  const finishWizard = useCallback(() => {
    markComplete();
    setIsOpen(false);
  }, [markComplete]);

  const handleSkip = useCallback(() => {
    finishWizard();
  }, [finishWizard]);

  const handleNext = useCallback(() => {
    if (isLastStep) {
      finishWizard();
      return;
    }
    setActiveIndex((index) => Math.min(index + 1, steps.length - 1));
  }, [finishWizard, isLastStep, steps.length]);

  const handleBack = useCallback(() => {
    setActiveIndex((index) => Math.max(index - 1, 0));
  }, []);

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) {
        handleSkip();
      } else {
        setIsOpen(true);
      }
    },
    [handleSkip],
  );

  if ((!forceShow && hasCompleted) || steps.length === 0) {
    return null;
  }

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Welcome to YakShaver</DialogTitle>
          <DialogDescription>
            Let’s walk through the essentials so you can start shaving yaks faster than ever.
          </DialogDescription>
        </DialogHeader>

        {currentStep && (
          <div className="space-y-6">
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                Step {clampedIndex + 1} of {steps.length}
              </p>
              <h3 className="mt-1 text-xl font-semibold">{currentStep.title}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{currentStep.description}</p>
            </div>

            {currentStep.tips?.length ? (
              <ul className="space-y-2 rounded-md border border-white/10 bg-white/5 p-4 text-sm">
                {currentStep.tips.map((tip) => (
                  <li key={tip} className="flex items-start gap-2">
                    <span className="mt-1 h-1.5 w-1.5 rounded-full bg-primary" />
                    <span>{tip}</span>
                  </li>
                ))}
              </ul>
            ) : null}

            <Progress value={completionPercent} aria-label="Onboarding progress" />
          </div>
        )}

        <DialogFooter className="mt-8 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <Button variant="ghost" onClick={handleSkip}>
            Skip for now
          </Button>
          <div className="flex gap-2 self-end sm:self-auto">
            <Button variant="outline" onClick={handleBack} disabled={clampedIndex === 0}>
              Back
            </Button>
            <Button onClick={handleNext}>{isLastStep ? "Finish" : "Next"}</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
