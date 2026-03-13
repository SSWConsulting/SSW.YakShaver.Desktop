import type { CustomPrompt } from "@/types";
import { PromptCard } from "./PromptCard";

interface PromptListViewProps {
  prompts: CustomPrompt[];
  onEdit: (prompt: CustomPrompt) => void;
  emptyMessage?: string;
}

export function PromptListView({
  prompts,
  onEdit,
  emptyMessage = "No prompts available",
}: PromptListViewProps) {
  if (prompts.length === 0) {
    return <p className="text-muted-foreground text-center py-8">{emptyMessage}</p>;
  }
  return (
    <div className="rounded-xl border border-border bg-card divide-y divide-border overflow-hidden">
      {prompts.map((prompt) => (
        <PromptCard key={prompt.id} prompt={prompt} onEdit={onEdit} />
      ))}
    </div>
  );
}
