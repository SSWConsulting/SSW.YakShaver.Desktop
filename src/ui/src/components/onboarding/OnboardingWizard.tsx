import { Bot, CheckCircle2, Circle, ClipboardList, ServerCog, Youtube } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { ConnectedStatus } from "@/components/auth/ConnectedStatus";
import { NotConnectedStatus } from "@/components/auth/NotConnectedStatus";
import { PlatformSelector } from "@/components/auth/PlatformSelector";
import { LLMSettingsPanel } from "@/components/settings/llm/LLMKeyManager";
import { McpSettingsPanel } from "@/components/settings/mcp/McpServerManager";
import { useYouTubeAuth } from "@/contexts/YouTubeAuthContext";
import { ipcClient } from "@/services/ipc-client";
import { AuthStatus } from "@/types";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card, CardContent } from "../ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../ui/dialog";
import { ScrollArea } from "../ui/scroll-area";

type StepId = "youtube" | "llm" | "mcp" | "issue";

interface OnboardingWizardProps {
  open: boolean;
  onComplete: () => void;
  onSkip: () => void;
}

interface StepConfig {
  id: StepId;
  title: string;
  description: string;
  status: "pending" | "active" | "complete";
  icon: ReactNode;
  content: ReactNode;
}

export function OnboardingWizard({ open, onComplete, onSkip }: OnboardingWizardProps) {
  const { authState, hasConfig } = useYouTubeAuth();
  const [currentStep, setCurrentStep] = useState<StepId>("youtube");
  const [llmConfigured, setLlmConfigured] = useState(false);
  const [mcpConfigured, setMcpConfigured] = useState(false);

  const youtubeConnected = authState.status === AuthStatus.AUTHENTICATED && !!authState.userInfo;
  const stepOrder: StepId[] = ["youtube", "llm", "mcp", "issue"];

  const refreshLlmStatus = useCallback(async () => {
    try {
      const cfg = await ipcClient.llm.getConfig();
      setLlmConfigured(!!cfg);
    } catch (error) {
      console.error("Failed to load LLM config", error);
    }
  }, []);

  const refreshMcpStatus = useCallback(async () => {
    try {
      const servers = await ipcClient.mcp.listServers();
      setMcpConfigured(servers.length > 0);
    } catch (error) {
      console.error("Failed to load MCP servers", error);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setCurrentStep("youtube");
    void refreshLlmStatus();
    void refreshMcpStatus();
  }, [open, refreshLlmStatus, refreshMcpStatus]);

  useEffect(() => {
    if (open && currentStep === "llm") {
      void refreshLlmStatus();
    }
    if (open && currentStep === "mcp") {
      void refreshMcpStatus();
    }
  }, [currentStep, open, refreshLlmStatus, refreshMcpStatus]);

  const steps: StepConfig[] = useMemo(() => {
    const baseSteps: StepConfig[] = [
      {
        id: "youtube",
        title: "Connect to YouTube",
        description: "Sign in and authorize YakShaver to publish videos for you.",
        status: youtubeConnected ? "complete" : "pending",
        icon: <Youtube className="h-4 w-4" />,
        content: <YouTubeStep hasConfig={hasConfig} />,
      },
      {
        id: "llm",
        title: "LLM configuration",
        description: "Choose your provider and save the API credentials.",
        status: llmConfigured ? "complete" : "pending",
        icon: <Bot className="h-4 w-4" />,
        content: (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Pick the model that YakShaver should use when generating tasks.
            </p>
            <div className="rounded-lg border border-white/10 bg-white/5 p-4">
              <LLMSettingsPanel
                isActive={open && currentStep === "llm"}
                onStatusChange={setLlmConfigured}
              />
            </div>
          </div>
        ),
      },
      {
        id: "mcp",
        title: "MCP server",
        description: "Configure or choose which MCP server YakShaver will call.",
        status: mcpConfigured ? "complete" : "pending",
        icon: <ServerCog className="h-4 w-4" />,
        content: (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Add a server or edit an existing one so YakShaver can run tools securely.
            </p>
            <div className="rounded-lg border border-white/10 bg-white/5 p-4">
              <McpSettingsPanel
                isActive={open && currentStep === "mcp"}
                onServersChange={(count) => setMcpConfigured(count > 0)}
              />
            </div>
          </div>
        ),
      },
      {
        id: "issue",
        title: "Create issue",
        description: "Finish setup and jump into your first request.",
        status: "pending",
        icon: <ClipboardList className="h-4 w-4" />,
        content: (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              You’re ready to go. You can now create an issue or return to the main experience to
              start a workflow. Visit Settings anytime to adjust YouTube, LLM, or MCP preferences.
            </p>
            <Button asChild variant="secondary" size="sm">
              <a href="https://github.com/SSWConsulting/SSW.YakShaver.Desktop/issues/new" target="_blank" rel="noreferrer">
                Open issue form
              </a>
            </Button>
          </div>
        ),
      },
    ];

    return baseSteps.map((step) => {
      const stepIdx = stepOrder.indexOf(step.id);
      const currentIdx = stepOrder.indexOf(currentStep);
      const isActive = currentStep === step.id;
      const isComplete =
        step.id === "youtube"
          ? youtubeConnected
          : step.id === "llm"
            ? llmConfigured
            : step.id === "mcp"
              ? mcpConfigured
              : currentIdx > stepIdx;

      return {
        ...step,
        status: isActive ? "active" : isComplete ? "complete" : "pending",
      };
    });
  }, [currentStep, hasConfig, llmConfigured, mcpConfigured, open, stepOrder, youtubeConnected]);

  const activeStep = steps.find((step) => step.id === currentStep) ?? steps[0];
  const currentIndex = stepOrder.indexOf(currentStep);
  const isLastStep = currentIndex === steps.length - 1;

  const goToStep = (direction: "next" | "prev") => {
    const offset = direction === "next" ? 1 : -1;
    const targetIndex = currentIndex + offset;
    if (targetIndex < 0 || targetIndex >= steps.length) return;
    setCurrentStep(stepOrder[targetIndex]);
  };

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onSkip()}>
      <DialogContent className="max-w-6xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-2xl">
            <span>Welcome to YakShaver</span>
          </DialogTitle>
          <p className="text-sm text-muted-foreground">
            Follow these quick steps to get ready. You can revisit Settings any time.
          </p>
        </DialogHeader>

        <div className="flex min-h-[520px] flex-col gap-4 md:flex-row">
          <div className="flex w-full flex-col gap-3 rounded-lg border border-white/10 bg-white/5 p-4 md:w-1/3">
            {steps.map((step, idx) => {
              const isActive = step.id === currentStep;
              const isComplete = step.status === "complete";
              return (
                <Card
                  key={step.id}
                  className={`border transition-colors ${
                    isActive
                      ? "border-white/60 bg-white/10"
                      : "border-white/10 bg-white/5 hover:border-white/30"
                  }`}
                >
                  <CardContent className="p-4">
                    <div className="flex items-start gap-3">
                      <div
                        className={`mt-0.5 flex h-10 w-10 items-center justify-center rounded-full ${
                          isComplete ? "bg-green-500/20 text-green-300" : "bg-white/10 text-white"
                        }`}
                      >
                        {step.icon}
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-semibold text-white">{step.title}</p>
                          {isComplete && <Badge variant="success">Done</Badge>}
                        </div>
                        <p className="text-xs text-white/60">{step.description}</p>
                        <div className="mt-2 flex items-center gap-1 text-[11px] text-white/50">
                          {isComplete ? (
                            <CheckCircle2 className="h-3 w-3 text-green-400" />
                          ) : (
                            <Circle className="h-3 w-3 text-white/40" />
                          )}
                          <span>{`Step ${idx + 1} of ${steps.length}`}</span>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          <div className="flex-1 rounded-lg border border-white/10 bg-[rgba(204,65,65,0.06)] p-6">
            <div className="mb-4 flex items-center justify-between">
              <Badge variant="secondary" className="uppercase tracking-wide">
                {`Step ${currentIndex + 1} of ${steps.length}`}
              </Badge>
              <div className="flex items-center gap-2 text-xs text-white/60">
                {steps.map((step) => {
                  const isComplete = step.status === "complete";
                  const isActive = step.id === currentStep;
                  return (
                    <div
                      key={step.id}
                      className={`h-2 w-2 rounded-full ${
                        isActive ? "bg-white" : isComplete ? "bg-green-400" : "bg-white/30"
                      }`}
                    />
                  );
                })}
              </div>
            </div>

            <div className="mb-4 space-y-2">
              <h2 className="text-2xl font-semibold text-white">{activeStep.title}</h2>
              <p className="text-sm text-white/70">{activeStep.description}</p>
            </div>

            <div className="rounded-lg border border-white/10 bg-white/5">
              <ScrollArea className="max-h-[420px]">
                <div className="p-5">{activeStep.content}</div>
              </ScrollArea>
            </div>

            <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <Button variant="ghost" onClick={onSkip}>
                Skip for now
              </Button>
              <div className="flex gap-2">
                <Button variant="outline" disabled={currentIndex === 0} onClick={() => goToStep("prev")}>
                  Back
                </Button>
                <Button onClick={() => (isLastStep ? onComplete() : goToStep("next"))}>
                  {isLastStep ? "Finish" : "Save and continue"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function YouTubeStep({ hasConfig }: { hasConfig: boolean }) {
  const { authState } = useYouTubeAuth();
  const [showSelector, setShowSelector] = useState(true);

  const { status, userInfo } = authState;
  const isConnected = status === AuthStatus.AUTHENTICATED && !!userInfo;

  useEffect(() => {
    if (isConnected) {
      setShowSelector(false);
    }
  }, [isConnected]);

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Connect your YouTube account so YakShaver can upload recordings and update metadata on your
        behalf.
      </p>
      <div className="max-w-3xl">
        {isConnected ? (
          <ConnectedStatus
            userInfo={userInfo}
            platform="YouTube"
            onSwitch={() => setShowSelector(true)}
          />
        ) : showSelector ? (
          <PlatformSelector onClose={() => setShowSelector(false)} hasYouTubeConfig={hasConfig} />
        ) : (
          <NotConnectedStatus onConnect={() => setShowSelector(true)} />
        )}
      </div>
    </div>
  );
}
