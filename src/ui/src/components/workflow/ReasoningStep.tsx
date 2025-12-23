import { Brain } from "lucide-react";
import { type ParsedResult, RawTextDisplay } from "./FinalResultPanel";

interface ReasoningStepProps {
  reasoning: string;
}

export function ReasoningStep({ reasoning }: ReasoningStepProps) {
  let parsed: ParsedResult = {};

  try {
    parsed = JSON.parse(reasoning);
  } catch (error) {
    console.error("Failed to parse reasoning:", error);
  }

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <Brain className="w-4 h-4" />
        AI Reasoning & Plan
      </div>
      <details className="ml-4 text-xs" open>
        <summary className="text-zinc-400 cursor-pointer hover:text-zinc-400/80">
          View details
        </summary>
        <RawTextDisplay content={parsed.text as string} />
      </details>
    </div>
  );
}
