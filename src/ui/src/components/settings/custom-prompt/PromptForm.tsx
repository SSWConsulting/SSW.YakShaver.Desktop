import { zodResolver } from "@hookform/resolvers/zod";
import { Trash2 } from "lucide-react";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { Button } from "../../ui/button";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "../../ui/form";
import { Input } from "../../ui/input";
import { Textarea } from "../../ui/textarea";
import { type PromptFormValues, promptFormSchema } from "./schema";

interface PromptFormProps {
  defaultValues?: PromptFormValues;
  onSubmit: (data: PromptFormValues, andActivate: boolean) => Promise<void>;
  onCancel: () => void;
  onDelete?: () => void;
  loading: boolean;
  isDefault?: boolean;
  onFormStateChange?: (isDirty: boolean) => void;
}

export function PromptForm({
  defaultValues,
  onSubmit,
  onCancel,
  onDelete,
  loading,
  isDefault = false,
  onFormStateChange,
}: PromptFormProps) {
  const form = useForm<PromptFormValues>({
    resolver: zodResolver(promptFormSchema),
    defaultValues: defaultValues || {
      name: "",
      description: "",
      content: "",
    },
    mode: "onChange",
  });

  const { isDirty } = form.formState;

  useEffect(() => {
    if (defaultValues) {
      form.reset(defaultValues);
    }
  }, [defaultValues, form]);

  useEffect(() => {
    onFormStateChange?.(isDirty);
  }, [isDirty, onFormStateChange]);

  const handleSubmit = async (andActivate: boolean) => {
    const isValid = await form.trigger();
    if (!isValid) return;

    const data = form.getValues();
    await onSubmit(data, andActivate);
  };

  return (
    <Form {...form}>
      <form className="flex flex-col gap-4 h-full">
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem className="shrink-0">
              <FormLabel className="text-white/90 text-sm">Prompt Name *</FormLabel>
              <FormControl>
                <Input
                  {...field}
                  placeholder="e.g., Documentation Writer, Code Reviewer"
                  disabled={isDefault}
                  className="bg-black/40 border-white/20"
                />
              </FormControl>
              {isDefault ? (
                <FormDescription className="text-white/50">
                  Default prompt name cannot be changed
                </FormDescription>
              ) : (
                <FormMessage />
              )}
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="description"
          render={({ field }) => (
            <FormItem className="shrink-0">
              <FormLabel className="text-white/90 text-sm">Description</FormLabel>
              <FormControl>
                <Input
                  {...field}
                  placeholder="Brief description of what this prompt does"
                  disabled={isDefault}
                  className="bg-black/40 border-white/20"
                />
              </FormControl>
              <FormDescription className="text-white/50">
                {isDefault
                  ? "Default prompt description cannot be changed"
                  : "This will be shown in the prompt card for quick reference"}
              </FormDescription>
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="content"
          render={({ field }) => (
            <FormItem className="flex flex-col flex-1 min-h-0 overflow-hidden">
              <FormLabel className="text-white/90 text-sm shrink-0">Prompt Instructions</FormLabel>
              <FormControl>
                <Textarea
                  {...field}
                  placeholder="Enter your custom instructions here..."
                  disabled={isDefault}
                  className="resize-none flex-1 max-h-50 overflow-y-auto font-mono text-sm bg-black/40 border-white/20"
                />
              </FormControl>
              <FormDescription className="text-white/50 shrink-0">
                {isDefault
                  ? "Default prompt instructions cannot be changed"
                  : "These instructions will be appended to the task execution system prompt"}
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="flex justify-between gap-2 shrink-0">
          {onDelete && (
            <Button
              type="button"
              onClick={onDelete}
              variant="destructive"
              size="sm"
              disabled={loading}
              className="cursor-pointer"
            >
              <Trash2 className="w-4 h-4 mr-2" />
              Delete
            </Button>
          )}
          <div className="flex gap-2 ml-auto">
            <Button
              type="button"
              variant="default"
              size="sm"
              onClick={onCancel}
              className="cursor-pointer"
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => handleSubmit(false)}
              disabled={loading || !form.formState.isValid}
              variant="secondary"
              size="sm"
              className="cursor-pointer"
            >
              {loading ? "Saving..." : "Save"}
            </Button>
            <Button
              type="button"
              onClick={() => handleSubmit(true)}
              disabled={loading || !form.formState.isValid}
              variant="secondary"
              size="sm"
              className="cursor-pointer"
            >
              {loading ? "Saving..." : "Save & Use"}
            </Button>
          </div>
        </div>
      </form>
    </Form>
  );
}
