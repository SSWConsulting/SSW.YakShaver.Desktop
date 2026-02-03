import type { ReactNode } from "react";
import type { Control, FieldPath, FieldValues } from "react-hook-form";
import { HealthStatus } from "@/components/health-status/health-status";
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { HealthStatusInfo } from "@/types";

export type ProviderOption = {
  value: string;
  label: string;
  disabled?: boolean;
};

interface LLMProviderFieldsProps<TFieldValues extends FieldValues> {
  control: Control<TFieldValues>;
  providerField: FieldPath<TFieldValues>;
  apiKeyField: FieldPath<TFieldValues>;
  providerOptions: ProviderOption[];
  onProviderChange?: (value: string) => void;
  providerLabel?: string;
  apiKeyLabel?: string;
  selectPlaceholder?: string;
  apiKeyPlaceholder?: string;
  apiKeyDescription?: ReactNode;
  selectContentClassName?: string;
  selectTriggerClassName?: string;
  inputClassName?: string;
  labelClassName?: string;
  healthStatus?: HealthStatusInfo | null;
  showHealthIndicator?: boolean;
}

export function LLMProviderFields<TFieldValues extends FieldValues>({
  control,
  providerField,
  apiKeyField,
  providerOptions,
  onProviderChange,
  providerLabel = "Provider",
  apiKeyLabel = "API Key",
  selectPlaceholder = "Select provider",
  apiKeyPlaceholder = "sk-...",
  apiKeyDescription,
  selectContentClassName = "z-[60]",
  selectTriggerClassName = "cursor-pointer",
  inputClassName,
  labelClassName = "text-white",
  healthStatus,
  showHealthIndicator = true,
}: LLMProviderFieldsProps<TFieldValues>) {
  return (
    <>
      <FormField
        control={control}
        name={providerField}
        render={({ field }) => (
          <FormItem>
            <FormLabel className={labelClassName}>{providerLabel}</FormLabel>
            <Select
              onValueChange={(value) => {
                field.onChange(value);
                onProviderChange?.(value);
              }}
              value={field.value}
            >
              <FormControl>
                <SelectTrigger className={selectTriggerClassName}>
                  <SelectValue placeholder={selectPlaceholder} />
                </SelectTrigger>
              </FormControl>
              <SelectContent className={selectContentClassName}>
                {providerOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value} disabled={option.disabled}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FormMessage />
          </FormItem>
        )}
      />

      <FormField
        control={control}
        name={apiKeyField}
        render={({ field }) => (
          <FormItem>
            <FormLabel className={labelClassName}>{apiKeyLabel}</FormLabel>
            <div className="relative">
              {showHealthIndicator && healthStatus && (
                <div className="absolute left-3 top-1/2 -translate-y-1/2 z-10">
                  <HealthStatus
                    isChecking={healthStatus.isChecking ?? false}
                    isHealthy={healthStatus.isHealthy ?? false}
                    successMessage={healthStatus.successMessage}
                    error={healthStatus.error}
                    isDisabled={false}
                  />
                </div>
              )}
              <FormControl>
                <Input
                  {...field}
                  placeholder={apiKeyPlaceholder}
                  type="password"
                  className={cn(healthStatus && showHealthIndicator ? "pl-10" : "", inputClassName)}
                />
              </FormControl>
            </div>
            {apiKeyDescription ? (
              <FormDescription className="text-xs text-white/60">
                {apiKeyDescription}
              </FormDescription>
            ) : null}
            <FormMessage />
          </FormItem>
        )}
      />
    </>
  );
}
