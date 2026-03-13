import type { CustomPrompt } from "@/types";
import { Button } from "../../ui/button";
import { Card } from "../../ui/card";

interface PromptCardProps {
  prompt: CustomPrompt;
  onEdit: (prompt: CustomPrompt) => void;
}

export function PromptCard({ prompt, onEdit }: PromptCardProps) {
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <h3 className="font-medium truncate mb-1">{prompt.name}</h3>
          {prompt.description && (
            <p className="text-muted-foreground text-sm line-clamp-2">{prompt.description}</p>
          )}
        </div>
        <div className="flex gap-2 shrink-0">
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
    </Card>
  );
}
