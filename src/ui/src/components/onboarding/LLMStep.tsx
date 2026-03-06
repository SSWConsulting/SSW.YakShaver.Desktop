import { LLM_PROVIDER_CONFIGS } from "@shared/llm/llm-providers";
import type { ProviderName } from "@shared/types/llm";
import { CircleAlert, Mic } from "lucide-react";
import { useEffect } from "react";
import { LLMProviderFields } from "@/components/llm/LLMProviderFields";
import {
  LANGUAGE_PROVIDER_NAMES,
  LLM_STEP_ID,
  TRANSCRIPTION_PROVIDER_NAMES,
} from "@/types/onboarding";
import { useOnboardingLLM } from "../../hooks/useOnboardingLLM";
import { Form } from "../ui/form";

interface LLMStepProps {
  onValidationChange: (isValid: boolean) => void;
}

export function LLMStep({ onValidationChange }: LLMStepProps) {
  const {
    llmForm,
    transcriptionForm,
    healthStatus,
    isNextEnabled,
    languageProviderSupportsTranscription,
    handleLLMSubmit,
    handleProviderChange,
    handleTranscriptionProviderChange,
  } = useOnboardingLLM(LLM_STEP_ID);

  useEffect(() => {
    onValidationChange(isNextEnabled);
  }, [isNextEnabled, onValidationChange]);

  const languageProvider = llmForm.watch("provider") as ProviderName;

  return (
    <>
      {/* Section title */}
      <p className="text-sm font-medium text-white">Choose your LLM</p>

      {/* Language Model Section */}
      <div className="w-full">
        <p className="mb-3 text-xs font-medium uppercase leading-4 text-white/60">LLM</p>
        <Form {...llmForm}>
          <form onSubmit={llmForm.handleSubmit(handleLLMSubmit)} className="flex flex-col gap-4">
            <LLMProviderFields
              control={llmForm.control}
              providerField="provider"
              apiKeyField="apiKey"
              providerOptions={LANGUAGE_PROVIDER_NAMES}
              onProviderChange={(value) => handleProviderChange(value as ProviderName)}
              healthStatus={healthStatus}
              selectContentClassName="z-[70]"
            />
          </form>
        </Form>
      </div>

      {/* Warning when provider doesn't support transcription */}
      {!languageProviderSupportsTranscription && (
        <div className="flex items-start gap-3 rounded-md border border-destructive/50 p-4">
          <CircleAlert className="mt-0.5 size-4 shrink-0 text-destructive" />
          <div>
            <p className="text-sm font-medium text-destructive">Transcription Model Required</p>
            <p className="text-sm text-destructive/70">
              {LLM_PROVIDER_CONFIGS[languageProvider]?.label} doesn&apos;t support video
              transcription. Please add a model for transcription.
            </p>
          </div>
        </div>
      )}

      {/* Transcription Model Section */}
      {!languageProviderSupportsTranscription && (
        <div className="flex w-full flex-col gap-4 rounded-lg border border-white/20 p-4">
          <div className="flex items-center gap-2">
            <Mic className="size-4 text-white/70" />
            <p className="text-sm font-medium text-white">Transcription Model</p>
          </div>
          <Form {...transcriptionForm}>
            <form className="flex flex-col gap-4">
              <LLMProviderFields
                control={transcriptionForm.control}
                providerField="provider"
                apiKeyField="apiKey"
                providerOptions={TRANSCRIPTION_PROVIDER_NAMES}
                onProviderChange={(value) =>
                  handleTranscriptionProviderChange(value as ProviderName)
                }
                selectContentClassName="z-[70]"
              />
            </form>
          </Form>
        </div>
      )}
    </>
  );
}
