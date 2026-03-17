import type { CustomPrompt } from "@/types";
import { Button } from "../../ui/button";

interface PromptCardProps {
  prompt: CustomPrompt;
  onEdit: (prompt: CustomPrompt) => void;
}

export function PromptCard({ prompt, onEdit }: PromptCardProps) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3 overflow-hidden">
      <div className="flex-1 min-w-0">
        <h3 className="font-medium truncate" title={prompt.name}>
          {prompt.name}
        </h3>
        {prompt.description && (
          <p
            className="text-muted-foreground text-sm line-clamp-2 mt-0.5 break-words"
            title={prompt.description}
          >
            {prompt.description}
          </p>
        )}
      </div>
      <div className="shrink-0">
        <Button
          onClick={() => onEdit(prompt)}
          variant="default"
          size="sm"
          className="cursor-pointer"
        >
          Edit
        </Button>
      </div>
    </div>
  );
}
