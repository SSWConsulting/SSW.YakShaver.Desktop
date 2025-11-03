import { Trash2 } from "lucide-react";
import { useId } from "react";
import { Button } from "../../ui/button";
import { Input } from "../../ui/input";
import { Label } from "../../ui/label";
import { Textarea } from "../../ui/textarea";
import type { PromptFormData } from "./types";

interface PromptFormProps {
  formData: PromptFormData;
  onChange: (data: Partial<PromptFormData>) => void;
  onSave: (andActivate: boolean) => void;
  onCancel: () => void;
  onDelete?: () => void;
  loading: boolean;
  isDefault?: boolean;
}

export function PromptForm({
  formData,
  onChange,
  onSave,
  onCancel,
  onDelete,
  loading,
  isDefault = false,
}: PromptFormProps) {
  const promptNameId = useId();
  const promptDescriptionId = useId();
  const promptInstructionsId = useId();

  return (
    <div className="flex flex-col gap-4 h-full">
      <div className="flex flex-col gap-2 shrink-0">
        <Label htmlFor={promptNameId} className="text-white/90 text-sm">
          Prompt Name *
        </Label>
        <Input
          id={promptNameId}
          value={formData.name}
          onChange={(e) => onChange({ name: e.target.value })}
          placeholder="e.g., Documentation Writer, Code Reviewer"
          disabled={isDefault}
          className="bg-black/40 border-white/20"
        />
        {isDefault && (
          <p className="text-white/50 text-xs">Default prompt name cannot be changed</p>
        )}
      </div>

      <div className="flex flex-col gap-2 shrink-0">
        <Label htmlFor={promptDescriptionId} className="text-white/90 text-sm">
          Description
        </Label>
        <Input
          id={promptDescriptionId}
          value={formData.description}
          onChange={(e) => onChange({ description: e.target.value })}
          placeholder="Brief description of what this prompt does"
          className="bg-black/40 border-white/20"
        />
        <p className="text-white/50 text-xs">
          This will be shown in the prompt card for quick reference
        </p>
      </div>

      <div className="flex flex-col gap-2 flex-1 min-h-0 overflow-hidden">
        <Label htmlFor={promptInstructionsId} className="text-white/90 text-sm shrink-0">
          Prompt Instructions
        </Label>
        <Textarea
          id={promptInstructionsId}
          value={formData.content}
          onChange={(e) => onChange({ content: e.target.value })}
          placeholder="Enter your custom instructions here..."
          className="resize-none flex-1 max-h-50 overflow-y-auto font-mono text-sm bg-black/40 border-white/20"
        />
        <p className="text-white/50 text-xs shrink-0">
          These instructions will be appended to the task execution system prompt
        </p>
      </div>

      <div className="flex justify-between gap-2 pt-4 border-t border-white/10 shrink-0">
        {onDelete && (
          <Button
            onClick={onDelete}
            variant="destructive"
            size="sm"
            disabled={loading}
            className="cursor-pointer border-2 border-red-500 hover:border-red-600"
          >
            <Trash2 className="w-4 h-4 mr-2" />
            Delete
          </Button>
        )}
        <div className="flex gap-2 ml-auto">
          <Button variant="default" size="sm" onClick={onCancel} className="cursor-pointer">
            Cancel
          </Button>
          <Button
            onClick={() => onSave(false)}
            disabled={loading || !formData.name.trim()}
            variant="secondary"
            size="sm"
            className="cursor-pointer"
          >
            {loading ? "Saving..." : "Save"}
          </Button>
          <Button
            onClick={() => onSave(true)}
            disabled={loading || !formData.name.trim()}
            variant="secondary"
            size="sm"
            className="cursor-pointer"
          >
            {loading ? "Saving..." : "Save & Use"}
          </Button>
        </div>
      </div>
    </div>
  );
}
