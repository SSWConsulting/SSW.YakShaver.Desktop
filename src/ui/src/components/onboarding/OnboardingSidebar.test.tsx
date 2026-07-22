import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { OnboardingStep, StepStatus } from "@/types/onboarding";
import { STEPS } from "@/types/onboarding";
import { OnboardingSidebar } from "./OnboardingSidebar";

vi.mock("@shared/llm/llm-providers", () => ({ LLM_PROVIDER_CONFIGS: {} }));

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

  it("uses the brand color only for the current step icon", () => {
    renderSidebar({ 1: "completed", 2: "current", 3: "pending" });

    const currentRow = screen.getByText(STEPS[1].title).closest('[aria-current="step"]');
    expect(currentRow?.querySelector(".bg-ssw-red")).not.toBeNull();
    const completedRow = screen.getByText(STEPS[0].title).parentElement?.parentElement;
    expect(completedRow?.querySelector(".bg-ssw-red")).toBeNull();
    const pendingRow = screen.getByText(STEPS[2].title).parentElement?.parentElement;
    expect(pendingRow?.querySelector(".bg-ssw-red")).toBeNull();
  });

  it("keeps row spacing stable as the current highlight moves", () => {
    const { rerender } = renderSidebar({ 1: "current", 2: "pending", 3: "pending" });

    for (const step of STEPS) {
      expect(screen.getByText(step.title).closest('[class*="py-2"]')).not.toBeNull();
    }

    rerender(
      <OnboardingSidebar
        connectorPositions={[]}
        stepListRef={{ current: null }}
        stepIconRefs={{ current: [] }}
        getSidebarStepStatus={(step) => {
          if (step.id === 2) return "current";
          return step.id < 2 ? "completed" : "pending";
        }}
      />,
    );

    for (const step of STEPS) {
      expect(screen.getByText(step.title).closest('[class*="py-2"]')).not.toBeNull();
    }
  });

  it("highlights the final step as current once the wizard reaches it", () => {
    renderSidebar({ 1: "completed", 2: "completed", 3: "current" });

    const lastTitle = screen.getByText(STEPS[2].title);
    const lastRow = lastTitle.closest('[aria-current="step"]');
    expect(lastRow).not.toBeNull();
    expect(lastRow?.querySelector(".bg-ssw-red")).not.toBeNull();
  });

  it("keeps completed and pending steps visually distinct from each other", () => {
    renderSidebar({ 1: "completed", 2: "current", 3: "pending" });

    // Pending remains deemphasized (existing greyed-out treatment).
    expect(screen.getByText(STEPS[2].title)).toHaveClass("text-white/[0.65]");
    // Completed is not deemphasized, but does not use the current icon color.
    const completedTitle = screen.getByText(STEPS[0].title);
    expect(completedTitle).toHaveClass("text-white/[0.98]");
    expect(completedTitle.parentElement?.parentElement?.querySelector(".bg-ssw-red")).toBeNull();
  });
});
