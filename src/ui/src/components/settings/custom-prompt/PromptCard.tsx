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
    <Card
      className={clsx(
        "p-4 bg-black/30 border transition-colors",
        isActive ? "border-white/40 bg-white/5" : "border-white/20 hover:border-white/30",
      )}
    >
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
              <Badge className="text-xs bg-green-400/10 text-green-400 border-green-400/30 hover:bg-green-400/20">
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
              variant="default"
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
