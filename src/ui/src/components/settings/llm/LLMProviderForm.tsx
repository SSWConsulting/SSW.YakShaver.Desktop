import type { ModelConfig } from "@shared/types/llm";
import { Loader2 } from "lucide-react";
import type { UseFormReturn } from "react-hook-form";
import { LLMProviderFields, type ProviderOption } from "@/components/llm/LLMProviderFields";
import type { HealthStatusInfo } from "../../../types";
import { Button } from "../../ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "../../ui/form";
import { Input } from "../../ui/input";

export type LLMProvider = "openai" | "deepseek" | "azure" | "byteplus";

type LLMProviderFormProps = {
  form: UseFormReturn<ModelConfig>;
  onSubmit: (values: ModelConfig) => Promise<void>;
  onClear: () => Promise<void>;
  isLoading: boolean;
  hasConfig: boolean;
  handleProviderChange: (value: "openai" | "deepseek" | "azure" | "byteplus") => void;
  providerOptions?: ProviderOption[];
  healthStatus?: HealthStatusInfo | null;
};

export function LLMProviderForm({
  form,
  onSubmit,
  onClear,
  isLoading,
  hasConfig,
  handleProviderChange,
  providerOptions = [],
  healthStatus,
}: LLMProviderFormProps) {
  const provider = form.watch("provider");
  const isAzureProvider = provider === "azure";

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4">
        <LLMProviderFields
          control={form.control}
          providerField="provider"
          apiKeyField="apiKey"
          providerOptions={providerOptions}
          onProviderChange={(value) => handleProviderChange(value as LLMProvider)}
          healthStatus={healthStatus}
          apiKeyDescription="Stored securely on this device."
          apiKeyPlaceholder={isAzureProvider ? "Azure OpenAI API Key" : "sk-..."}
          selectContentClassName="z-[70]"
        />

        {isAzureProvider && (
          <div className="grid gap-3">
            <FormField
              control={form.control}
              name="resourceName"
              render={({ field }) => (
                <FormItem className="flex flex-col gap-2">
                  <FormLabel className="text-white">Resource Name</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="my-azure-ai-001" type="text" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
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
          <Button type="submit" size="sm" disabled={isLoading}>
            {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Save
          </Button>
        </div>
      </form>
    </Form>
  );
}
