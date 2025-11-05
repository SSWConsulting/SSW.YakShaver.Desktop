import { Brain } from "lucide-react";

interface ReasoningData {
  goal?: string;
  approach?: string;
  tools?: string[];
  steps?: Array<string | { description: string }>;
}

interface ReasoningStepProps {
  reasoning: string;
}

export function ReasoningStep({ reasoning }: ReasoningStepProps) {
  let parsed: ReasoningData = {};

  try {
    parsed = JSON.parse(reasoning);
  } catch (error) {
    console.error("Failed to parse reasoning:", error);
  }

  return (
    <div className="space-y-1">
      <div className="text-secondary font-medium flex items-center gap-2">
        <Brain className="w-4 h-4" />
        AI Reasoning & Plan
      </div>
      <details className="ml-4 text-xs" open>
        <summary className="text-zinc-400 cursor-pointer hover:text-zinc-400/80">
          View details
        </summary>
        <div className="mt-1 p-3 bg-black/30 border border-white/10 rounded-md text-white/90 text-sm space-y-3">
          {parsed.goal && (
            <div>
              <div className="text-white/90 font-semibold mb-1">Goal:</div>
              <div className="text-white/80">{parsed.goal}</div>
            </div>
          )}
          {parsed.approach && (
            <div>
              <div className="text-white/90 font-semibold mb-1">Approach:</div>
              <div className="text-white/80">{parsed.approach}</div>
            </div>
          )}
          {parsed.tools && parsed.tools.length > 0 && (
            <div>
              <div className="text-white/90 font-semibold mb-1">Tools:</div>
              <div className="flex flex-wrap gap-2">
                {parsed.tools.map((tool: string, idx: number) => (
                  <span
                    key={`${idx}-${tool.slice(0, 20)}`}
                    className="px-2 py-1 bg-white/10 rounded text-xs text-white/70"
                  >
                    {tool}
                  </span>
                ))}
              </div>
            </div>
          )}
          {parsed.steps && parsed.steps.length > 0 && (
            <div>
              <div className="text-white/90 font-semibold mb-1">Execution Plan:</div>
              <div className="space-y-1">
                {parsed.steps.map((step, idx: number) => {
                  const stepText = typeof step === "string" ? step : step.description;
                  return (
                    <div key={`${idx}-${stepText.slice(0, 20)}`} className="flex items-start gap-2">
                      <span className="text-white/60">{idx + 1}.</span>
                      <span className="flex-1">{stepText}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </details>
    </div>
  );
}
