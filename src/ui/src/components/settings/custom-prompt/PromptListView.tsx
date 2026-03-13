import type { CustomPrompt } from "@/types";
import { PromptCard } from "./PromptCard";

interface PromptListViewProps {
  prompts: CustomPrompt[];
  activePromptId: string | null;
  onEdit: (prompt: CustomPrompt) => void;
  onSetActive: (promptId: string) => void;
  emptyMessage?: string;
}

export function PromptListView({
  prompts,
  activePromptId,
  onEdit,
  onSetActive,
  emptyMessage = "No prompts available",
}: PromptListViewProps) {
  return (
    <div className="flex flex-col gap-4">
      {prompts.length === 0 ? (
        <p className="text-muted-foreground text-center py-8">{emptyMessage}</p>
      ) : (
        prompts.map((prompt) => (
          <PromptCard
            key={prompt.id}
            prompt={prompt}
            isActive={prompt.id === activePromptId}
            onEdit={onEdit}
            onSetActive={onSetActive}
          />
        ))
      )}
    </div>
  );
}
