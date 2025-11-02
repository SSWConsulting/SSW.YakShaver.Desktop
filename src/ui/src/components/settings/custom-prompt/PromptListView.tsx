import type { CustomPrompt } from "@/types";
import { SearchBar } from "../../common/SearchBar";
import { ScrollArea } from "../../ui/scroll-area";
import { Separator } from "../../ui/separator";
import { PromptCard } from "./PromptCard";

interface PromptListViewProps {
  prompts: CustomPrompt[];
  activePromptId: string | null;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  onCreateNew: () => void;
  onEdit: (prompt: CustomPrompt) => void;
  onSetActive: (promptId: string) => void;
}

export function PromptListView({
  prompts,
  activePromptId,
  searchQuery,
  onSearchChange,
  onCreateNew,
  onEdit,
  onSetActive,
}: PromptListViewProps) {
  return (
    <div className="flex flex-col gap-4 h-full overflow-hidden">
      <SearchBar
        value={searchQuery}
        onChange={onSearchChange}
        placeholder="Search prompts..."
        buttonText="Add New Prompt"
        onButtonClick={onCreateNew}
      />
      <Separator className="bg-white/10 shrink-0" />
      <ScrollArea className="h-[50vh]">
        <div className="flex flex-col space-y-4 pr-4">
          {prompts.length === 0 ? (
            <p className="text-white/50 text-center py-8">
              {searchQuery ? "No prompts found matching your search" : "No prompts available"}
            </p>
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
      </ScrollArea>
    </div>
  );
}
