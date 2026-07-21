import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { OnboardingStep, StepStatus } from "@/types/onboarding";
import { STEPS } from "@/types/onboarding";
import { OnboardingSidebar } from "./OnboardingSidebar";

/**
 * #963: the left-hand step list had no distinct visual treatment for the current
 * step — "current" and "completed" statuses were styled identically, so users
 * could not tell which step they were on (the only signal was the small
 * "Step X of Y" text elsewhere on the page). These tests assert the current step
 * now gets a distinct highlight (aria-current, bold text, accent-coloured icon)
 * and that non-current steps remain visually deemphasized/unhighlighted.
 */
function renderSidebar(statusByStepId: Record<number, StepStatus>) {
  const getSidebarStepStatus = (step: OnboardingStep): StepStatus =>
    statusByStepId[step.id] ?? "pending";

  return render(
    <OnboardingSidebar
      connectorPositions={[]}
      stepListRef={{ current: null }}
      stepIconRefs={{ current: [] }}
      getSidebarStepStatus={getSidebarStepStatus}
    />,
  );
}

describe("OnboardingSidebar current step highlight (#963)", () => {
  it("marks only the current step with aria-current=step", () => {
    renderSidebar({ 1: "completed", 2: "current", 3: "pending" });

    const currentTitle = screen.getByText(STEPS[1].title);
    const currentRow = currentTitle.closest('[aria-current="step"]');
    expect(currentRow).not.toBeNull();

    const completedTitle = screen.getByText(STEPS[0].title);
    expect(completedTitle.closest('[aria-current="step"]')).toBeNull();

    const pendingTitle = screen.getByText(STEPS[2].title);
    expect(pendingTitle.closest('[aria-current="step"]')).toBeNull();
  });

  it("renders the current step's title in bold, distinct from completed and pending steps", () => {
    renderSidebar({ 1: "completed", 2: "current", 3: "pending" });

    expect(screen.getByText(STEPS[1].title)).toHaveClass("font-bold");
    expect(screen.getByText(STEPS[0].title)).not.toHaveClass("font-bold");
    expect(screen.getByText(STEPS[2].title)).not.toHaveClass("font-bold");
  });

  it("highlights the final step as current once the wizard reaches it", () => {
    renderSidebar({ 1: "completed", 2: "completed", 3: "current" });

    const lastTitle = screen.getByText(STEPS[2].title);
    expect(lastTitle.closest('[aria-current="step"]')).not.toBeNull();
    expect(lastTitle).toHaveClass("font-bold");
  });

  it("keeps completed and pending steps visually distinct from each other", () => {
    renderSidebar({ 1: "completed", 2: "current", 3: "pending" });

    // Pending remains deemphasized (existing greyed-out treatment).
    expect(screen.getByText(STEPS[2].title)).toHaveClass("text-white/[0.65]");
    // Completed is not deemphasized, but also not bold like current.
    const completedTitle = screen.getByText(STEPS[0].title);
    expect(completedTitle).toHaveClass("text-white/[0.98]");
    expect(completedTitle).not.toHaveClass("font-bold");
  });
});
