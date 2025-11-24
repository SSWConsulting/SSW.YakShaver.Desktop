import clsx from "clsx";
import type { CustomPrompt } from "@/types";
import { Badge } from "../../ui/badge";
import { Button } from "../../ui/button";
import { Card } from "../../ui/card";

interface PromptCardProps {
  prompt: CustomPrompt;
  isActive: boolean;
  onEdit: (prompt: CustomPrompt) => void;
  onSetActive: (promptId: string) => void;
}

export function PromptCard({ prompt, isActive, onEdit, onSetActive }: PromptCardProps) {
  return (
    <Card className={clsx("p-4", isActive ? "bg-accent" : "")}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-2">
            <h3 className="font-medium truncate">{prompt.name}</h3>
            {prompt.isDefault && (
              <Badge variant="secondary" className="text-xs">
                Default
              </Badge>
            )}
            {isActive && (
              <Badge variant="success" className="text-xs">
                Active
              </Badge>
            )}
          </div>
          {prompt.description && (
            <p className="text-muted-foreground text-sm line-clamp-2">{prompt.description}</p>
          )}
        </div>

        <div className="flex gap-2 shrink-0">
          {!isActive && (
            <Button
              onClick={() => onSetActive(prompt.id)}
              variant="outline"
              size="sm"
              className="cursor-pointer"
            >
              Select
            </Button>
          )}
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
