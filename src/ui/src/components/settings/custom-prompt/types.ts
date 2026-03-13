export type ViewMode = "list" | "edit" | "create" | "view-template";

export interface PromptFormData {
  name: string;
  description?: string;
  content: string;
  selectedMcpServerIds?: string[];
}
