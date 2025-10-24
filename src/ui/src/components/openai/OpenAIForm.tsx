import type { Dispatch, SetStateAction } from "react";
import { Input } from "../ui/input";
import type { LLMConfig } from "../../types";

export type OpenAILLMConfig = Extract<LLMConfig, { provider: "openai" }>;
export type AzureLLMConfig = Extract<LLMConfig, { provider: "azure" }>;

type OpenAIProviderFormProps = {
  llmForm: OpenAILLMConfig;
  setLlmForm: Dispatch<SetStateAction<LLMConfig>>;
};

type AzureOpenAIProviderFormProps = {
  llmForm: AzureLLMConfig;
  setLlmForm: Dispatch<SetStateAction<LLMConfig>>;
};

export function OpenAIProviderForm({
  llmForm,
  setLlmForm,
}: OpenAIProviderFormProps) {
  return (
    <div className="flex flex-col gap-2">
      <label className="text-white/90 text-sm">API Key</label>
      <Input
        value={llmForm.apiKey}
        onChange={(e) => setLlmForm({ ...llmForm, apiKey: e.target.value })}
        placeholder="sk-..."
        className="bg-black/40 border border-white/20 text-white"
        type="password"
      />
      <p className="text-white/50 text-xs">Stored securely on this device.</p>
    </div>
  );
}

export function AzureOpenAIProviderForm({
  llmForm,
  setLlmForm,
}: AzureOpenAIProviderFormProps) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2">
        <label className="text-white/90 text-sm">API Key</label>
        <Input
          value={llmForm.apiKey}
          onChange={(e) => setLlmForm({ ...llmForm, apiKey: e.target.value })}
          placeholder="Azure OpenAI API Key"
          className="bg-black/40 border border-white/20 text-white"
          type="password"
        />
      </div>
      <div className="flex flex-col gap-2">
        <label className="text-white/90 text-sm">Endpoint</label>
        <Input
          value={llmForm.endpoint}
          onChange={(e) => setLlmForm({ ...llmForm, endpoint: e.target.value })}
          placeholder="https://<resource>.openai.azure.com"
          className="bg-black/40 border border-white/20 text-white"
          type="text"
        />
      </div>
      <div className="flex flex-col gap-2">
        <label className="text-white/90 text-sm">API Version</label>
        <Input
          value={llmForm.version}
          onChange={(e) => setLlmForm({ ...llmForm, version: e.target.value })}
          placeholder="e.g. 2024-08-01-preview"
          className="bg-black/40 border border-white/20 text-white"
          type="text"
        />
      </div>
      <div className="flex flex-col gap-2">
        <label className="text-white/90 text-sm">Deployment Name</label>
        <Input
          value={llmForm.deployment}
          onChange={(e) =>
            setLlmForm({ ...llmForm, deployment: e.target.value })
          }
          placeholder="e.g. Whisper"
          className="bg-black/40 border border-white/20 text-white"
          type="text"
        />
      </div>
    </div>
  );
}
