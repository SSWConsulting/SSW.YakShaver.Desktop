import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { STEPS } from "@/types/onboarding";
import { StepFooter } from "./StepFooter";

vi.mock("@shared/llm/llm-providers", () => ({ LLM_PROVIDER_CONFIGS: {} }));

describe("StepFooter", () => {
  it("shows a chevron icon on the Next button before the last step", () => {
    render(
      <StepFooter currentStep={1} isNextDisabled={false} onNext={() => {}} onPrevious={() => {}} />,
    );

    const nextButton = screen.getByRole("button", { name: "Next" });
    expect(nextButton).toBeInTheDocument();
    expect(nextButton.className).toContain("self-end");
    expect(nextButton.querySelector("svg")).not.toBeNull();
  });

  it("shows Finish without a chevron on the final step", () => {
    render(
      <StepFooter
        currentStep={STEPS.length}
        isNextDisabled={false}
        onNext={() => {}}
        onPrevious={() => {}}
      />,
    );

    const finishButton = screen.getByRole("button", { name: "Finish" });
    expect(finishButton).toBeInTheDocument();
    expect(finishButton.querySelector("svg")).toBeNull();
  });
});
