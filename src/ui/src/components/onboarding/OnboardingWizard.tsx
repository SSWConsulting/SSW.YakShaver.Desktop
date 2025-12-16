import { Play } from "lucide-react";

export function OnboardingWizard() {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center">
      <div className="fixed inset-0 bg-[url('/background/YakShaver-Background.jpg')] bg-cover bg-center bg-no-repeat"></div>

      <div className="relative flex w-full max-w-[1295px] h-[840px] bg-black/[0.44] border border-white/[0.24] rounded-lg shadow-sm p-2.5 gap-10">
        {/* Left Sidebar */}
        <div className="flex w-[440px] h-full bg-[#1C0D05] rounded-md px-5 py-10 items-center justify-center">
          <div className="flex gap-8 items-center justify-center relative">
            {/* Timeline and Icons */}
            <div className="flex flex-row items-center">
              <div className="relative flex flex-col items-center justify-between w-[41px] h-full">
                {/* Line - completed steps */}
                <div className="absolute w-px h-[365px] bg-[#75594B] left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2" />
                {/* Line - pending steps */}
                <div className="absolute w-px h-[119px] bg-[#432A1D] left-1/2 top-[calc(50%+119px)] -translate-x-1/2 -translate-y-1/2" />

                {/* Step Icons */}
                <div className="flex flex-col items-center gap-[60px] relative z-10">
                  {/* Step 1 - Video Hosting */}
                  <div className="flex flex-col items-center gap-2 h-[60px]">
                    <div className="w-10 h-10 rounded-full bg-[#75594B] flex items-center justify-center">
                      <svg
                        width="24"
                        height="24"
                        viewBox="0 0 24 24"
                        fill="none"
                        className="text-[#FEF2F2]"
                      >
                        <rect
                          x="2"
                          y="7"
                          width="20"
                          height="10"
                          rx="2"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                        <path
                          d="M12 17v4M8 21h8"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                        <rect
                          x="10"
                          y="3"
                          width="4"
                          height="4"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </div>
                  </div>

                  {/* Step 2 - LLM */}
                  <div className="flex flex-col items-center gap-2 h-[60px]">
                    <div className="w-10 h-10 rounded-full bg-[#75594B] flex items-center justify-center">
                      <svg
                        width="24"
                        height="24"
                        viewBox="0 0 24 24"
                        fill="none"
                        className="text-[#FEF2F2]"
                      >
                        <rect
                          x="4"
                          y="4"
                          width="16"
                          height="16"
                          rx="2"
                          stroke="currentColor"
                          strokeWidth="2"
                        />
                        <rect
                          x="9"
                          y="9"
                          width="6"
                          height="6"
                          stroke="currentColor"
                          strokeWidth="2"
                        />
                        <line x1="12" y1="2" x2="12" y2="4" stroke="currentColor" strokeWidth="2" />
                        <line
                          x1="12"
                          y1="20"
                          x2="12"
                          y2="22"
                          stroke="currentColor"
                          strokeWidth="2"
                        />
                        <line x1="17" y1="2" x2="17" y2="4" stroke="currentColor" strokeWidth="2" />
                        <line
                          x1="17"
                          y1="20"
                          x2="17"
                          y2="22"
                          stroke="currentColor"
                          strokeWidth="2"
                        />
                        <line x1="7" y1="2" x2="7" y2="4" stroke="currentColor" strokeWidth="2" />
                        <line x1="7" y1="20" x2="7" y2="22" stroke="currentColor" strokeWidth="2" />
                        <line x1="2" y1="12" x2="4" y2="12" stroke="currentColor" strokeWidth="2" />
                        <line
                          x1="20"
                          y1="12"
                          x2="22"
                          y2="12"
                          stroke="currentColor"
                          strokeWidth="2"
                        />
                        <line x1="2" y1="17" x2="4" y2="17" stroke="currentColor" strokeWidth="2" />
                        <line
                          x1="20"
                          y1="17"
                          x2="22"
                          y2="17"
                          stroke="currentColor"
                          strokeWidth="2"
                        />
                        <line x1="2" y1="7" x2="4" y2="7" stroke="currentColor" strokeWidth="2" />
                        <line x1="20" y1="7" x2="22" y2="7" stroke="currentColor" strokeWidth="2" />
                      </svg>
                    </div>
                  </div>

                  {/* Step 3 - MCP */}
                  <div className="flex flex-col items-center gap-2 h-[60px]">
                    <div className="w-10 h-10 rounded-full bg-[#75594B] flex items-center justify-center">
                      <svg
                        width="24"
                        height="24"
                        viewBox="0 0 24 24"
                        fill="none"
                        className="text-[#FEF2F2]"
                      >
                        <rect
                          x="2"
                          y="7"
                          width="20"
                          height="10"
                          rx="2"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                        <path
                          d="M12 17v4M8 21h8"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                        <rect
                          x="10"
                          y="3"
                          width="4"
                          height="4"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </div>
                  </div>

                  {/* Step 4 - Record */}
                  <div className="flex flex-col items-center gap-2 h-[60px]">
                    <div className="w-10 h-10 rounded-full bg-[#432A1D] flex items-center justify-center">
                      <Play className="w-6 h-6 text-[#75594B]" fill="#75594B" />
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Step Labels */}
            <div className="flex flex-col gap-[60px] w-[219px]">
              {/* Step 1 */}
              <div className="flex items-center w-[200px]">
                <div className="flex flex-col justify-center">
                  <p className="text-sm font-medium leading-5 text-white/[0.98]">Video Hosting</p>
                  <p className="text-sm font-normal leading-5 text-white/[0.56]">
                    Sign in and Authorise YakShaver to publish videos for you.
                  </p>
                </div>
              </div>

              {/* Step 2 */}
              <div className="flex items-center w-[200px]">
                <div className="flex flex-col justify-center">
                  <p className="text-sm font-medium leading-5 text-white/[0.98]">
                    Connecting an LLM
                  </p>
                  <p className="text-sm font-normal leading-5 text-white/[0.56]">
                    Choose your provider and save the API details
                  </p>
                </div>
              </div>

              {/* Step 3 */}
              <div className="flex items-center w-full">
                <div className="flex flex-col justify-center">
                  <p className="text-sm font-medium leading-5 text-white/[0.98]">
                    Connecting an MCP
                  </p>
                  <p className="text-sm font-normal leading-5 text-white/[0.56]">
                    Configure or choose which MCP server YakShaver will call.
                  </p>
                </div>
              </div>

              {/* Step 4 */}
              <div className="flex items-center w-[220px]">
                <div className="flex flex-col justify-center">
                  <p className="text-sm font-medium leading-5 text-white/[0.98]">
                    Record your first Video
                  </p>
                  <p className="text-sm font-normal leading-5 text-white/[0.56]">
                    Finish setup and jump into your first request.
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Logo */}
          <div className="absolute top-[8.29%] left-[12.05%] w-[300px]">
            <div className="flex items-center gap-3">
              <svg width="53" height="24" viewBox="0 0 53 24" fill="none">
                <path
                  d="M8 4L4 8L8 12"
                  stroke="#CC4141"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d="M12 4L16 8L12 12"
                  stroke="#CC4141"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              <span className="text-xl font-semibold text-white">YakShaver</span>
            </div>
          </div>
        </div>

        {/* Right Content Area */}
        <div className="flex flex-col w-[759px] px-20 py-40">
          <div className="flex flex-col h-[330px] w-full">
            {/* Step indicator */}
            <div className="flex items-center justify-center px-6">
              <p className="text-sm font-medium leading-6 text-white">Step 1 of 4</p>
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
                  <button className="bg-[#DC2626] flex items-center justify-center px-4 py-2 rounded-md min-h-[40px] max-h-[40px]">
                    <Play className="w-4 h-4 text-white" fill="white" />
                  </button>
                </div>

                <div className="flex items-start px-6">
                  <p className="text-sm font-medium leading-6 text-white">Youtube</p>
                </div>

                <div className="flex gap-6 items-center">
                  <button className="bg-[#FAFAFA] flex items-center justify-center px-4 py-2 rounded-md min-h-[40px] max-h-[40px]">
                    <span className="text-sm font-medium text-[#18181B]">Connect</span>
                  </button>
                </div>
              </div>
            </div>

            {/* Card footer */}
            <div className="flex h-16 items-start justify-end px-6 pb-6 w-full">
              <div className="flex items-center justify-between w-full">
                <button className="flex items-center justify-center px-4 py-2">
                  <span className="text-sm font-medium leading-6 text-white/[0.98]">
                    Skip for now
                  </span>
                </button>

                <div className="flex h-10 w-[162px] relative">
                  <button className="absolute left-0 top-0 flex items-center justify-center px-4 py-2 border border-white/[0.24]">
                    <span className="text-sm font-medium leading-6 text-white/[0.98]">
                      Previous
                    </span>
                  </button>
                  <button className="absolute left-[98px] top-0 flex items-center justify-center px-4 py-2 bg-white/[0.92]">
                    <span className="text-sm font-medium leading-6 text-[#24150D]">Next</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
