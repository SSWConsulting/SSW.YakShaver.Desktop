import { Eye, FilePlus } from "lucide-react";
import type { CustomPrompt } from "@/types";
import { Button } from "../../ui/button";
import { Card } from "../../ui/card";

interface TemplateCardProps {
  template: CustomPrompt;
  onView: (template: CustomPrompt) => void;
  onUseTemplate: (template: CustomPrompt) => void;
}

export function TemplateCard({ template, onView, onUseTemplate }: TemplateCardProps) {
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <h3 className="font-medium truncate mb-1">{template.name}</h3>
          {template.description && (
            <p className="text-muted-foreground text-sm line-clamp-2">{template.description}</p>
          )}
        </div>

        <div className="flex flex-col gap-2 shrink-0">
          <Button
            onClick={() => onView(template)}
            variant="outline"
            size="sm"
            className="cursor-pointer"
          >
            <Eye className="w-4 h-4 mr-1" />
            View
          </Button>
          <Button
            onClick={() => onUseTemplate(template)}
            variant="default"
            size="sm"
            className="cursor-pointer"
          >
            <FilePlus className="w-4 h-4 mr-1" />
            Use Template
          </Button>
        </div>
      </div>
    </Card>
  );
}
