import { z } from "zod";

export const promptFormSchema = z.object({
  name: z.string().min(1, "Prompt name is required").trim(),
  description: z.string().trim().optional(),
  content: z.string().min(1, "Prompt content is required").trim(),
});

export type PromptFormValues = z.infer<typeof promptFormSchema>;
