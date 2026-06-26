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
    <Card className="p-4 overflow-hidden">
      <div className="flex items-center justify-between gap-3">
        <div className="flex-1 min-w-0">
          <h3 className="font-medium truncate mb-1" title={template.name}>
            {template.name}
          </h3>
          {template.description && (
            <p
              className="text-muted-foreground text-sm line-clamp-2 break-words"
              title={template.description}
            >
              {template.description}
            </p>
          )}
        </div>

        <div className="flex flex-row items-center gap-2 shrink-0">
          <Button
            onClick={() => onView(template)}
            variant="outline"
            size="sm"
            className="flex-1 min-w-0 cursor-pointer"
          >
            View
          </Button>
          <Button
            onClick={() => onUseTemplate(template)}
            variant="default"
            size="sm"
            className="flex-1 min-w-0 cursor-pointer"
          >
            Use
          </Button>
        </div>
      </div>
    </Card>
  );
}
