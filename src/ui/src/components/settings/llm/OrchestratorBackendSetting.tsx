import type { LLMConfigV2, OrchestrationBackend } from "@shared/types/llm";
import { DEFAULT_ORCHESTRATION_BACKEND } from "@shared/types/llm";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ipcClient } from "@/services/ipc-client";
import { formatErrorMessage } from "@/utils";

interface OrchestratorBackendSettingProps {
  isActive: boolean;
}

interface BackendOption {
  id: OrchestrationBackend;
  title: string;
  description: string;
}

const BACKEND_OPTIONS: readonly BackendOption[] = [
  {
    id: "openai",
    title: "OpenAI",
    description: "Drive backlog creation with the built-in language model loop. (Default)",
  },
  {
    id: "local-claude",
    title: "Claude Code",
    description:
      "Drive backlog creation with a local headless `claude` process. Requires the `claude` CLI installed and on PATH.",
  },
];

const BACKEND_LABELS: Record<OrchestrationBackend, string> = {
  openai: "OpenAI",
  "local-claude": "Claude Code",
};

export function OrchestratorBackendSetting({ isActive }: OrchestratorBackendSettingProps) {
  const [currentBackend, setCurrentBackend] = useState<OrchestrationBackend>(
    DEFAULT_ORCHESTRATION_BACKEND,
  );
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [pendingBackend, setPendingBackend] = useState<OrchestrationBackend | null>(null);

  useEffect(() => {
    if (!isActive) {
      return;
    }

    let cancelled = false;
    const load = async () => {
      setIsLoading(true);
      try {
        const cfg = await ipcClient.llm.getConfig();
        if (!cancelled) {
          setCurrentBackend(cfg?.orchestrationBackend ?? DEFAULT_ORCHESTRATION_BACKEND);
        }
      } catch (error) {
        console.error("Failed to load orchestrator backend setting", error);
        toast.error(`Failed to load orchestrator setting: ${formatErrorMessage(error)}`);
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [isActive]);

  const handleSelect = useCallback(
    async (backend: OrchestrationBackend) => {
      if (backend === currentBackend) {
        return;
      }

      setPendingBackend(backend);
      try {
        // Preserve every other field on the V2 config; only flip the backend.
        const existing = await ipcClient.llm.getConfig();
        const next: LLMConfigV2 = {
          version: 2,
          languageModel: existing?.languageModel ?? null,
          transcriptionModel: existing?.transcriptionModel ?? null,
          providerApiKeys: existing?.providerApiKeys,
          orchestrationBackend: backend,
        };
        const result = await ipcClient.llm.setConfig(next);
        if (!result.success) {
          throw new Error("Failed to update orchestrator backend");
        }
        setCurrentBackend(backend);
        toast.success(`Orchestrator set to ${BACKEND_LABELS[backend]}`);
      } catch (error) {
        console.error("Failed to update orchestrator backend", error);
        toast.error(`Failed to update orchestrator: ${formatErrorMessage(error)}`);
      } finally {
        setPendingBackend(null);
      }
    },
    [currentBackend],
  );

  return (
    <Card className="w-full gap-4 border-white/10 py-4">
      <CardHeader className="px-4">
        <CardTitle>Orchestrator</CardTitle>
        <CardDescription>
          Choose which backend drives backlog creation. Claude Code requires the{" "}
          <code className="rounded bg-white/10 px-1 py-0.5 text-xs">claude</code> CLI installed, and
          uses your Claude Code sign-in (no API key).
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-2 px-4">
        <Select
          value={currentBackend}
          onValueChange={(value) => void handleSelect(value as OrchestrationBackend)}
          disabled={isLoading || pendingBackend !== null}
        >
          <SelectTrigger className="w-full md:w-72" aria-label="Orchestrator backend">
            <SelectValue placeholder="Select an orchestrator" />
          </SelectTrigger>
          <SelectContent>
            {BACKEND_OPTIONS.map((option) => (
              <SelectItem key={option.id} value={option.id}>
                {option.title}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs leading-relaxed text-muted-foreground">
          {BACKEND_OPTIONS.find((o) => o.id === currentBackend)?.description}
        </p>
      </CardContent>
    </Card>
  );
}
