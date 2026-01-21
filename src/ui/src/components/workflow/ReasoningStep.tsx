import { Brain, ChevronRight } from "lucide-react";
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
    <details className="group space-y-1" open>
      <summary className="flex items-center gap-2 cursor-pointer hover:text-primary/90 list-none [&::-webkit-details-marker]:hidden">
        <Brain className="w-4 h-4" />
        <span>AI Reasoning &amp; Plan</span>
        <ChevronRight className="h-4 w-4 transition-transform group-open:rotate-90 ml-auto" />
      </summary>
      <div className="ml-4 text-xs">
        <RawTextDisplay content={(parsed.text ?? "") as string} />
      </div>
    </details>
  );
}
