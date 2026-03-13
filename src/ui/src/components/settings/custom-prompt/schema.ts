import { z } from "zod";

export const PROMPT_NAME_MAX = 100;
export const PROMPT_DESCRIPTION_MAX = 200;

export const promptFormSchema = z.object({
  name: z
    .string()
    .min(1, "Prompt name is required")
    .max(PROMPT_NAME_MAX, `Name must be ${PROMPT_NAME_MAX} characters or less`)
    .trim(),
  description: z
    .string()
    .max(PROMPT_DESCRIPTION_MAX, `Description must be ${PROMPT_DESCRIPTION_MAX} characters or less`)
    .trim()
    .optional(),
  content: z.string().min(1, "Prompt content is required").trim(),
  selectedMcpServerIds: z.array(z.string()).optional(),
});

export type PromptFormValues = z.infer<typeof promptFormSchema>;
