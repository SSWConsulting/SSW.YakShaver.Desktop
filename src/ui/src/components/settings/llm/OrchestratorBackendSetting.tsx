import type { LLMConfigV2, OrchestrationBackend, OrchestratorReadiness } from "@shared/types/llm";
import { DEFAULT_ORCHESTRATION_BACKEND } from "@shared/types/llm";
import { AlertTriangle, Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
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
      'Drive backlog creation with a local headless `claude` process. Requires the `claude` CLI installed and on PATH, and still needs a configured OpenAI/Azure language model to verify success. Under "ask" approval mode only whitelisted tools run (no runtime approval prompt), and YakShaver\'s built-in screenshot tools are unavailable.',
  },
];

const BACKEND_LABELS: Record<OrchestrationBackend, string> = {
  openai: "OpenAI",
  "local-claude": "Claude Code",
};

/** Narrows a raw Select value to a known backend, so `onValueChange` doesn't rely on a bare cast. */
function isOrchestrationBackend(value: string): value is OrchestrationBackend {
  return BACKEND_OPTIONS.some((option) => option.id === value);
}

export function OrchestratorBackendSetting({ isActive }: OrchestratorBackendSettingProps) {
  const [currentBackend, setCurrentBackend] = useState<OrchestrationBackend>(
    DEFAULT_ORCHESTRATION_BACKEND,
  );
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [pendingBackend, setPendingBackend] = useState<OrchestrationBackend | null>(null);
  const [readiness, setReadiness] = useState<OrchestratorReadiness | null>(null);
  const [isCheckingReadiness, setIsCheckingReadiness] = useState<boolean>(false);

  // Probe whether the Claude Code backend is actually usable (CLI installed + signed in). Cheap and
  // non-blocking; the result drives the warning + instructions below. Only relevant for the
  // local-claude backend — it spawns `claude --version`, so skip (and clear) it for OpenAI to
  // avoid spawning the CLI when Claude Code isn't in use.
  const checkReadiness = useCallback(async () => {
    setIsCheckingReadiness(true);
    try {
      const result = await ipcClient.llm.checkOrchestratorReadiness();
      setReadiness(result);
    } catch (error) {
      console.error("Failed to check orchestrator readiness", error);
      setReadiness(null);
    } finally {
      setIsCheckingReadiness(false);
    }
  }, []);

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
          const backend = cfg?.orchestrationBackend ?? DEFAULT_ORCHESTRATION_BACKEND;
          setCurrentBackend(backend);
          // Only probe Claude Code readiness when it's the selected backend; otherwise clear any
          // stale result so a prior local-claude warning doesn't linger under OpenAI.
          if (backend === "local-claude") {
            void checkReadiness();
          } else {
            setReadiness(null);
          }
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
  }, [isActive, checkReadiness]);

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
        // Surface readiness right after choosing Claude Code so the user learns immediately if the
        // CLI is missing or not signed in.
        if (backend === "local-claude") {
          void checkReadiness();
        }
      } catch (error) {
        console.error("Failed to update orchestrator backend", error);
        toast.error(`Failed to update orchestrator: ${formatErrorMessage(error)}`);
      } finally {
        setPendingBackend(null);
      }
    },
    [currentBackend, checkReadiness],
  );

  return (
    <Card className="w-full gap-4 border-white/10 py-4">
      <CardHeader className="px-4">
        <CardTitle>Orchestrator</CardTitle>
        <CardDescription>
          Choose which backend drives backlog creation. Claude Code requires the{" "}
          <code className="rounded bg-white/10 px-1 py-0.5 text-xs">claude</code> CLI installed, and
          uses your Claude Code sign-in instead of an Anthropic API key.
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-2 px-4">
        <Select
          value={currentBackend}
          onValueChange={(value) => {
            if (isOrchestrationBackend(value)) void handleSelect(value);
          }}
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

        {/* Claude Code readiness: warn + instruct when the backend is selected but the local CLI
            isn't installed or isn't signed in, so the user fixes it BEFORE a run fails. */}
        {currentBackend === "local-claude" && readiness && !readiness.ready && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-950/40 px-3 py-2 text-xs leading-relaxed text-amber-100"
          >
            <AlertTriangle
              className="mt-0.5 h-4 w-4 shrink-0 text-amber-400"
              role="img"
              aria-label="Claude Code not ready"
            />
            <div className="flex min-w-0 flex-col gap-2">
              <span className="break-words">{readiness.message}</span>
              <div>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 border-amber-500/40 bg-transparent text-amber-100 hover:bg-amber-500/10"
                  onClick={() => void checkReadiness()}
                  disabled={isCheckingReadiness}
                >
                  {isCheckingReadiness && <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />}
                  Re-check
                </Button>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
