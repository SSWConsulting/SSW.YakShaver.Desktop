import type { ConnectorPosition, OnboardingStep, StepStatus } from "@/types/onboarding";
import { STEPS } from "@/types/onboarding";
import logo from "/logos/SQ-YakShaver-LogoIcon-Red.svg?url";

interface OnboardingSidebarProps {
  connectorPositions: ConnectorPosition[];
  stepListRef: React.RefObject<HTMLDivElement | null>;
  stepIconRefs: React.MutableRefObject<(HTMLDivElement | null)[]>;
  getSidebarStepStatus: (step: OnboardingStep) => StepStatus;
}

export function OnboardingSidebar({
  connectorPositions,
  stepListRef,
  stepIconRefs,
  getSidebarStepStatus,
}: OnboardingSidebarProps) {
  return (
    <div className="hidden md:flex flex-col items-center md:w-[360px] lg:w-[440px] xl:w-[480px] h-full bg-[#1C0D05] rounded-md px-5 pt-[150px] pb-[150px]">
      <div className="w-[300px]">
        {/* Logo */}
        <div className="flex items-center mb-3">
          <img src={logo} alt="YakShaver" className="w-20 h-auto pr-2.5" />
          <span className="text-3xl font-bold text-ssw-red">Yak</span>
          <span className="text-3xl">Shaver</span>
        </div>
        <p className="text-base font-normal leading-5 text-white/[0.76] pb-6">
          Get started by setting up your workspace.
        </p>

        <div ref={stepListRef} className="relative flex gap-10 flex-col">
          {connectorPositions.map((position, index) => {
            const nextSidebarStep = STEPS[index + 1];
            if (!nextSidebarStep) return null;

            const status = getSidebarStepStatus(nextSidebarStep);

            return (
              <div
                key={`connector-${nextSidebarStep.id}`}
                className={`absolute w-px transition-colors duration-300 ${
                  status === "pending" ? "bg-[#432A1D]" : "bg-[#75594B]"
                }`}
                style={{
                  left: position.left,
                  top: position.top,
                  height: position.height,
                }}
              />
            );
          })}

          {STEPS.map((step, index) => {
            const status = getSidebarStepStatus(step);
            return (
              <div key={step.id} className="flex gap-8">
                <div className="flex flex-col items-center">
                  <div
                    ref={(element) => {
                      stepIconRefs.current[index] = element;
                    }}
                    className={`w-10 h-10 rounded-full flex items-center justify-center transition-colors duration-300 ${
                      status === "pending" ? "bg-[#432A1D]" : "bg-[#75594B]"
                    }`}
                  >
                    <img
                      src={step.icon}
                      alt={step.title}
                      className={`w-6 h-6 transition-opacity duration-300 ${
                        status === "pending" ? "opacity-40" : "opacity-100"
                      }`}
                    />
                  </div>
                </div>

                <div className="flex flex-col justify-center w-[219px]">
                  <p
                    className={`text-sm font-medium leading-5 transition-opacity duration-300 ${
                      status === "pending" ? "text-white/[0.65]" : "text-white/[0.98]"
                    }`}
                  >
                    {step.title}
                  </p>
                  <p className="text-sm font-normal leading-5 text-white/[0.55]">
                    {step.sidebarDescription}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
