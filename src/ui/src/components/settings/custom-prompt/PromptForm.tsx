import { zodResolver } from "@hookform/resolvers/zod";
import { Copy, Trash2 } from "lucide-react";
import { forwardRef, useEffect, useImperativeHandle } from "react";
import { useForm } from "react-hook-form";
import { useClipboard } from "../../../hooks/useClipboard";
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
}

export interface PromptFormRef {
  isDirty: () => boolean;
}

export const PromptForm = forwardRef<PromptFormRef, PromptFormProps>(
  ({ defaultValues, onSubmit, onCancel, onDelete, loading, isDefault = false }, ref) => {
    const { copyToClipboard } = useClipboard();

    const form = useForm<PromptFormValues>({
      resolver: zodResolver(promptFormSchema),
      defaultValues: defaultValues || {
        name: "",
        description: "",
        content: "",
      },
      mode: "onChange",
    });

    // Subscribe to formState to ensure it's tracked
    const { isDirty } = form.formState;

    // Expose form state to parent via ref
    useImperativeHandle(
      ref,
      () => ({
        isDirty: () => isDirty,
      }),
      [isDirty],
    );

    useEffect(() => {
      if (defaultValues) {
        form.reset(defaultValues);
      }
    }, [defaultValues, form]);

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
                <div className="flex items-center justify-between shrink-0">
                  <FormLabel className="text-white/90 text-sm">Prompt Instructions</FormLabel>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => copyToClipboard(field.value)}
                    className="cursor-pointer"
                  >
                    <Copy className="w-4 h-4" />
                    Copy
                  </Button>
                </div>
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
                variant="outline"
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
                size="sm"
                className="cursor-pointer"
              >
                {loading ? "Saving..." : "Save"}
              </Button>
              <Button
                type="button"
                onClick={() => handleSubmit(true)}
                disabled={loading || !form.formState.isValid}
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
  },
);

PromptForm.displayName = "PromptForm";
