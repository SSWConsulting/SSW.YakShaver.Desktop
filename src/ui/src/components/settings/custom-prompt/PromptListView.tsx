import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { CustomPrompt } from "@/types";
import { SearchBar } from "../../common/SearchBar";
import { ScrollArea } from "../../ui/scroll-area";
import { Separator } from "../../ui/separator";
import { PromptCard } from "./PromptCard";

interface PromptListViewProps {
  prompts: CustomPrompt[];
  activePromptId: string | null;
  onCreateNew: () => void;
  onEdit: (prompt: CustomPrompt) => void;
  onSetActive: (promptId: string) => void;
}

export function PromptListView({
  prompts,
  activePromptId,
  onCreateNew,
  onEdit,
  onSetActive,
}: PromptListViewProps) {
  const [searchQuery, setSearchQuery] = useState("");

  // Filter prompts based on search query
  const filteredPrompts = prompts.filter((prompt) => {
    if (!searchQuery.trim()) return true;
    const query = searchQuery.toLowerCase();
    return (
      prompt.name.toLowerCase().includes(query) || prompt.description?.toLowerCase().includes(query)
    );
  });

  return (
    <div className="flex flex-col gap-4 h-full overflow-hidden">
      <div className="flex items-center gap-2">
        <SearchBar value={searchQuery} onChange={setSearchQuery} placeholder="Search prompts..." />
        <Button onClick={onCreateNew} size="sm" className="shrink-0">
          Add New Prompt
        </Button>
      </div>
      <Separator className="bg-white/10 shrink-0" />
      <ScrollArea className="h-[50vh]">
        <div className="flex flex-col space-y-4 pr-4">
          {filteredPrompts.length === 0 ? (
            <p className="text-white/50 text-center py-8">
              {searchQuery ? "No prompts found matching your search" : "No prompts available"}
            </p>
          ) : (
            filteredPrompts.map((prompt) => (
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
