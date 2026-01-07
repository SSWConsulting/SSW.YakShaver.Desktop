import { Settings } from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "../ui/dialog";
import { ScrollArea } from "../ui/scroll-area";
import { AccountSettingsPanel } from "./account/AccountSettingsPanel";
import { AdvancedSettingsPanel } from "./advanced/AdvancedSettingsPanel";
import { CustomPromptSettingsPanel } from "./custom-prompt/CustomPromptManager";
import { GeneralSettingsPanel } from "./general/GeneralSettingsPanel";
import { GitHubTokenSettingsPanel } from "./github-token/GitHubTokenManager";
import { LLMSettingsPanel } from "./llm/LLMKeyManager";
import { McpSettingsPanel } from "./mcp/McpServerManager";
import { ReleaseChannelSettingsPanel } from "./release-channels/ReleaseChannelManager";

type LeaveHandler = () => Promise<boolean>;

interface SettingsTab {
  id: string;
  label: string;
}

const TABS: SettingsTab[] = [
  {
    id: "toolApproval",
    label: "Tool approval",
  },
  {
    id: "release",
    label: "Releases",
  },
  {
    id: "github",
    label: "GitHub Token",
  },
  {
    id: "prompts",
    label: "Custom Prompts",
  },
  {
    id: "llm",
    label: "LLM",
  },
  {
    id: "mcp",
    label: "MCP Servers",
  },
  {
    id: "advanced",
    label: "Advanced",
  },
  {
    id: "account",
    label: "Account",
  },
];

export function SettingsDialog() {
  const [open, setOpen] = useState(false);
  const [activeTabId, setActiveTabId] = useState<string>(TABS[0]?.id ?? "release");
  const leaveHandlerRef = useRef<LeaveHandler | null>(null);

  const registerLeaveHandler = useCallback((handler: LeaveHandler | null) => {
    leaveHandlerRef.current = handler;
  }, []);

  const attemptClose = useCallback(() => {
    if (!leaveHandlerRef.current) {
      setOpen(false);
      return;
    }

    void (async () => {
      const canClose = await leaveHandlerRef.current?.();
      if (canClose) {
        registerLeaveHandler(null);
        setOpen(false);
      } else {
        setOpen(true);
      }
    })();
  }, [registerLeaveHandler]);

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) {
        attemptClose();
        return;
      }
      setOpen(true);
    },
    [attemptClose],
  );

  const attemptTabChange = useCallback(
    (tabId: string) => {
      if (tabId === activeTabId) return;

      if (!leaveHandlerRef.current) {
        setActiveTabId(tabId);
        return;
      }

      void (async () => {
        const canLeave = await leaveHandlerRef.current?.();
        if (canLeave) {
          registerLeaveHandler(null);
          setActiveTabId(tabId);
        }
      })();
    },
    [activeTabId, registerLeaveHandler],
  );

  const activeTab = useMemo(
    () => TABS.find((tab) => tab.id === activeTabId) ?? TABS[0],
    [activeTabId],
  );

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button size="sm" className="flex items-center gap-2" aria-label="Open settings">
          <Settings className="h-4 w-4" />
          <span>Settings</span>
        </Button>
      </DialogTrigger>

      <DialogContent className="w-[min(800px,72vw)] max-w-none sm:max-w-none max-h-[85vh] overflow-hidden">
        <DialogHeader className="mb-6">
          <DialogTitle className="text-2xl font-semibold flex items-center gap-2">
            <Settings className="h-5 w-5" />
            Settings
          </DialogTitle>
          <p className="text-muted-foreground text-sm">
            Configure YakShaver preferences and integrations.
          </p>
        </DialogHeader>

        <div className="flex gap-6 h-[calc(85vh-120px)] overflow-hidden min-h-0">
          <nav className="w-48 flex flex-col gap-1 flex-shrink-0">
            {TABS.map((tab) => {
              const isActive = tab.id === activeTabId;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => attemptTabChange(tab.id)}
                  className={`text-left px-3 py-2 rounded-md transition-colors border border-transparent ${
                    isActive ? "bg-white/10 border-white/20" : "text-white/60 hover:bg-white/5"
                  }`}
                >
                  <div className="text-sm font-medium">{tab.label}</div>
                </button>
              );
            })}
          </nav>

          <section className="flex-1 h-full overflow-hidden">
            <ScrollArea className="h-full pr-1">
              <div className="pb-4 pr-2">
                {activeTab?.id === "toolApproval" && (
                  <GeneralSettingsPanel isActive={open && activeTabId === "toolApproval"} />
                )}
                {activeTab?.id === "release" && (
                  <ReleaseChannelSettingsPanel isActive={open && activeTabId === "release"} />
                )}
                {activeTab?.id === "github" && (
                  <GitHubTokenSettingsPanel isActive={open && activeTabId === "github"} />
                )}
                {activeTab?.id === "prompts" && (
                  <CustomPromptSettingsPanel
                    isActive={open && activeTabId === "prompts"}
                    registerLeaveHandler={registerLeaveHandler}
                  />
                )}
                {activeTab?.id === "llm" && (
                  <LLMSettingsPanel isActive={open && activeTabId === "llm"} />
                )}
                {activeTab?.id === "mcp" && (
                  <McpSettingsPanel isActive={open && activeTabId === "mcp"} />
                )}
                {activeTab?.id === "advanced" && <AdvancedSettingsPanel />}
                {activeTab?.id === "account" && (
                  <AccountSettingsPanel isActive={open && activeTabId === "account"} />
                )}
              </div>
            </ScrollArea>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
