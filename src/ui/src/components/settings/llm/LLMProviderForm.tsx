import { Loader2 } from "lucide-react";
import type { Control, UseFormReturn } from "react-hook-form";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../ui/select";
import type { FormValues } from "./LLMKeyManager";

export type LLMProvider = "openai" | "azure";

type LLMProviderSelectProps = {
  control: Control<FormValues>;
  handleProviderChange: (value: LLMProvider) => void;
};

function LLMProviderSelect({ control, handleProviderChange }: LLMProviderSelectProps) {
  return (
    <FormField
      control={control}
      name="provider"
      render={({ field }) => (
        <FormItem>
          <FormLabel>Provider</FormLabel>
          <Select
            onValueChange={(v: LLMProvider) => {
              field.onChange(v);
              handleProviderChange(v);
            }}
            defaultValue={field.value}
          >
            <FormControl>
              <SelectTrigger className="bg-black/40 cursor-pointer border border-white/20 text-white">
                <SelectValue placeholder="Select provider" />
              </SelectTrigger>
            </FormControl>
            <SelectContent>
              <SelectItem value="openai">OpenAI</SelectItem>
              <SelectItem value="azure" disabled={true}>
                Azure OpenAI
              </SelectItem>
            </SelectContent>
          </Select>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

type OpenAIProviderFormProps = {
  control: Control<FormValues>;
};

type AzureOpenAIProviderFormProps = {
  control: Control<FormValues>;
};

function OpenAIProviderForm({ control }: OpenAIProviderFormProps) {
  return (
    <FormField
      control={control}
      name="apiKey"
      render={({ field }) => (
        <FormItem className="flex flex-col gap-2">
          <FormLabel className="text-white/90 text-sm">API Key</FormLabel>
          <FormControl>
            <Input
              {...field}
              placeholder="sk-..."
              className="bg-black/40 border border-white/20 text-white"
              type="password"
            />
          </FormControl>
          <FormDescription className="text-white/50 text-xs">
            Stored securely on this device.
          </FormDescription>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

function AzureOpenAIProviderForm({ control }: AzureOpenAIProviderFormProps) {
  return (
    <div className="flex flex-col gap-3">
      <FormField
        control={control}
        name="apiKey"
        render={({ field }) => (
          <FormItem className="flex flex-col gap-2">
            <FormLabel className="text-white/90 text-sm">API Key</FormLabel>
            <FormControl>
              <Input
                {...field}
                placeholder="Azure OpenAI API Key"
                className="bg-black/40 border border-white/20 text-white"
                type="password"
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      <FormField
        control={control}
        name="endpoint"
        render={({ field }) => (
          <FormItem className="flex flex-col gap-2">
            <FormLabel className="text-white/90 text-sm">Endpoint</FormLabel>
            <FormControl>
              <Input
                {...field}
                placeholder="https://<resource>.openai.azure.com"
                className="bg-black/40 border border-white/20 text-white"
                type="text"
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      <FormField
        control={control}
        name="version"
        render={({ field }) => (
          <FormItem className="flex flex-col gap-2">
            <FormLabel className="text-white/90 text-sm">API Version</FormLabel>
            <FormControl>
              <Input
                {...field}
                placeholder="e.g. 2024-08-01-preview"
                className="bg-black/40 border border-white/20 text-white"
                type="text"
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      <FormField
        control={control}
        name="deployment"
        render={({ field }) => (
          <FormItem className="flex flex-col gap-2">
            <FormLabel className="text-white/90 text-sm">Deployment Name</FormLabel>
            <FormControl>
              <Input
                {...field}
                placeholder="e.g. Whisper"
                className="bg-black/40 border border-white/20 text-white"
                type="text"
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
    </div>
  );
}

type LLMProviderFormProps = {
  form: UseFormReturn<FormValues>;
  onSubmit: (values: FormValues) => Promise<void>;
  onClear: () => Promise<void>;
  isLoading: boolean;
  hasConfig: boolean;
  handleProviderChange: (value: "openai" | "azure") => void;
};

export function LLMProviderForm({
  form,
  onSubmit,
  onClear,
  isLoading,
  hasConfig,
  handleProviderChange,
}: LLMProviderFormProps) {
  const provider = form.watch("provider");

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4">
        <LLMProviderSelect control={form.control} handleProviderChange={handleProviderChange} />
        {provider === "openai" ? (
          <OpenAIProviderForm control={form.control} />
        ) : (
          <AzureOpenAIProviderForm control={form.control} />
        )}
        <div className="flex justify-start gap-2">
          <Button
            type="button"
            variant="destructive"
            size="sm"
            onClick={onClear}
            disabled={isLoading || !hasConfig}
          >
            Clear Config
          </Button>
          <Button type="submit" variant="secondary" size="sm" disabled={isLoading}>
            {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Save
          </Button>
        </div>
      </form>
    </Form>
  );
}
