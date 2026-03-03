import { LLM_PROVIDER_CONFIGS } from "@shared/llm/llm-providers";
import type { LLMConfigV2, ModelConfig, ProviderName } from "@shared/types/llm";
import type { UseFormReturn } from "react-hook-form";
import type { ProviderOption } from "@/components/llm/LLMProviderFields";
import type { HealthStatusInfo } from "@/types";
import cpu from "/onboarding/cpu.svg?url";
import monitorPlay from "/onboarding/monitor-play.svg?url";

export interface ConnectorPosition {
  top: number;
  height: number;
  left: number;
}

export type StepStatus = "current" | "completed" | "pending";

export interface OnboardingStep {
  id: number;
  icon: string;
  title: string;
  description: string;
  sidebarDescription: string;
  navSteps: readonly number[];
}

export const STEPS: readonly OnboardingStep[] = [
  {
    id: 1,
    icon: monitorPlay,
    title: "Video Hosting",
    description: "Choose a platform to host your videos.",
    sidebarDescription: "Authorise YakShaver to publish videos for you.",
    navSteps: [1],
  },
  {
    id: 2,
    icon: cpu,
    title: "Connecting an LLM",
    description: "Connect an LLM to transcribe your meetings and take your notes.",
    sidebarDescription: "Choose your provider and save the API details",
    navSteps: [2],
  },
  {
    id: 3,
    icon: monitorPlay,
    title: "Connecting an MCP",
    description: "Configure or Choose which MCP server YakShaver will call.",
    sidebarDescription: "Configure or choose which MCP server YakShaver will call.",
    navSteps: [3],
  },
] satisfies OnboardingStep[];

const PROVIDER_NAMES = Object.keys(LLM_PROVIDER_CONFIGS) as ProviderName[];

export const TRANSCRIPTION_PROVIDER_NAMES: ProviderOption[] = PROVIDER_NAMES.filter(
  (providerName) => LLM_PROVIDER_CONFIGS[providerName].defaultTranscriptionModel !== undefined,
).map((name) => ({ label: LLM_PROVIDER_CONFIGS[name].label, value: name }));

export const LANGUAGE_PROVIDER_NAMES: ProviderOption[] = PROVIDER_NAMES.filter(
  (providerName) => LLM_PROVIDER_CONFIGS[providerName].defaultLanguageModel !== undefined,
).map((name) => ({ label: LLM_PROVIDER_CONFIGS[name].label, value: name }));

export interface OnboardingLLMState {
  currentLLMConfig: LLMConfigV2 | null;
  hasLLMConfig: boolean;
  isLLMSaving: boolean;
  healthStatus: HealthStatusInfo | null;
  hasTranscriptionConfig: boolean;
  languageProviderSupportsTranscription: boolean;
  llmForm: UseFormReturn<ModelConfig>;
  transcriptionForm: UseFormReturn<ModelConfig>;
  handleLLMSubmit: (values: ModelConfig) => Promise<void>;
  handleProviderChange: (value: ProviderName) => Promise<void>;
  handleTranscriptionProviderChange: (value: ProviderName) => Promise<void>;
}
