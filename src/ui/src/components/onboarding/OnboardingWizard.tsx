import { useState } from "react";
import { FaYoutube } from "react-icons/fa";
import { Button } from "../ui/button";

const STEPS = [
  {
    id: 1,
    icon: "/onboarding/monitor-play.svg",
    title: "Video Hosting",
    description: "Sign in and Authorise YakShaver to publish videos for you.",
  },
  {
    id: 2,
    icon: "/onboarding/cpu.svg",
    title: "Connecting an LLM",
    description: "Choose your provider and save the API details",
  },
  {
    id: 3,
    icon: "/onboarding/monitor-play.svg",
    title: "Connecting an MCP",
    description: "Configure or choose which MCP server YakShaver will call.",
  },
  {
    id: 4,
    icon: "/onboarding/play.svg",
    title: "Record your first Video",
    description: "Finish setup and jump into your first request.",
  },
];

export function OnboardingWizard() {
  const [currentStep, setCurrentStep] = useState(1);

  const handleNext = () => {
    if (currentStep < 4) {
      setCurrentStep(currentStep + 1);
    }
  };

  const handlePrevious = () => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1);
    }
  };

  const getStepStatus = (step: number) => {
    if (step < currentStep) return "completed";
    if (step === currentStep) return "current";
    return "pending";
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center">
      <div className="fixed inset-0 bg-[url('/background/YakShaver-Background.jpg')] bg-cover bg-center bg-no-repeat"></div>

      <div className="relative flex w-full max-w-[1295px] h-[840px] bg-black/[0.44] border border-white/[0.24] rounded-lg shadow-sm p-2.5 gap-10">
        {/* Left Sidebar */}
        <div className="flex flex-col w-[440px] h-full bg-[#1C0D05] rounded-md px-5 py-10">
          {/* Logo */}
          <div className="w-full">
            <div className="flex items-center">
              <img
                src="/logos/SQ-YakShaver-LogoIcon-Red.svg"
                alt="YakShaver"
                className="w-18 h-auto pr-2.5"
              />
              <span className="text-3xl font-bold text-ssw-red">Yak</span>
              <span className="text-3xl">Shaver</span>
            </div>
          </div>

          <div className="flex gap-8 items-center justify-center flex-1">
            {/* Timeline and Icons */}
            <div className="flex flex-row items-center">
              <div className="relative flex flex-col items-center justify-between w-[41px] h-full">
                {/* Progress lines */}
                <div className="absolute w-px h-full bg-[#432A1D] left-1/2 top-0 -translate-x-1/2" />
                <div
                  className="absolute w-px bg-[#75594B] left-1/2 top-0 -translate-x-1/2 transition-all duration-300"
                  style={{
                    height:
                      currentStep === 1
                        ? "0%"
                        : currentStep === 2
                          ? "33%"
                          : currentStep === 3
                            ? "66%"
                            : "100%",
                  }}
                />

                {/* Step Icons */}
                <div className="flex flex-col items-center gap-[60px] relative z-10">
                  {STEPS.map((step, index) => (
                    <div
                      key={step.id}
                      className={`flex flex-col items-center gap-2 ${index < STEPS.length - 1 ? "h-[60px]" : ""}`}
                    >
                      <div
                        className={`w-10 h-10 rounded-full flex items-center justify-center transition-colors duration-300 ${
                          getStepStatus(step.id) === "pending" ? "bg-[#432A1D]" : "bg-[#75594B]"
                        }`}
                      >
                        <img
                          src={step.icon}
                          alt={step.title}
                          className={`w-6 h-6 transition-opacity duration-300 ${
                            getStepStatus(step.id) === "pending" ? "opacity-40" : "opacity-100"
                          }`}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Step Labels */}
            <div className="flex flex-col gap-[60px] w-[219px]">
              {STEPS.map((step) => (
                <div key={step.id} className="flex items-center w-[200px]">
                  <div className="flex flex-col justify-center">
                    <p
                      className={`text-sm font-medium leading-5 transition-opacity duration-300 ${
                        getStepStatus(step.id) === "pending" ? "text-white/[0.56]" : "text-white/[0.98]"
                      }`}
                    >
                      {step.title}
                    </p>
                    <p className="text-sm font-normal leading-5 text-white/[0.56]">
                      {step.description}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right Content Area */}
        <div className="flex flex-col w-[759px] px-20 py-40">
          <div className="flex flex-col h-[330px] w-full">
            {/* Step indicator */}
            <div className="flex items-center justify-center px-6">
              <p className="text-sm font-medium leading-6 text-white">Step {currentStep} of 4</p>
            </div>

            {/* Card header */}
            <div className="flex flex-col gap-1.5 p-6 w-full">
              <div className="flex items-center justify-center">
                <p className="text-2xl font-semibold leading-6 tracking-[-0.015em] text-white/[0.98]">
                  Video Hosting
                </p>
              </div>
              <div className="flex items-center justify-center w-full">
                <p className="text-sm font-normal leading-5 text-white/[0.56]">
                  Choose a platform to host your videos.
                </p>
              </div>
            </div>

            {/* Card content */}
            <div className="flex flex-col gap-4 px-6 pb-6 w-full">
              <div className="flex items-center justify-between px-6 py-4 bg-white/[0.04] border border-white/[0.24] rounded-lg w-full">
                <div className="flex gap-6 items-center">
                  <FaYoutube className="w-10 h-10 text-ssw-red text-2xl" />
                </div>

                <div className="flex items-start px-6">
                  <p className="text-sm font-medium leading-6 text-white">Youtube</p>
                </div>

                <div className="flex gap-6 items-center">
                  <Button size="lg">Connect</Button>
                </div>
              </div>
            </div>

            {/* Card footer */}
            <div className="flex h-16 items-start justify-end px-6 pb-6 w-full">
              <div className="flex items-center justify-between w-full">
                <Button
                  className="flex items-center justify-center px-4 py-2"
                  type="button"
                  variant="ghost"
                  size="sm"
                >
                  Skip for now
                </Button>

                <div className="flex gap-2 h-10">
                  <Button
                    className="flex items-center justify-center px-4 py-2"
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handlePrevious}
                    disabled={currentStep === 1}
                  >
                    Previous
                  </Button>

                  <Button
                    className="flex items-center justify-center px-4 py-2"
                    size="sm"
                    onClick={handleNext}
                    disabled={currentStep === 4}
                  >
                    Next
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
