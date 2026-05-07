import { Settings } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "../ui/dialog";
import { ScrollArea } from "../ui/scroll-area";
import { AccountSettingsPanel } from "./account/AccountSettingsPanel";
import { AdvancedSettingsPanel } from "./advanced/AdvancedSettingsPanel";
import { CustomPromptSettingsPanel } from "./custom-prompt/CustomPromptManager";
import { GeneralSettingsPanel } from "./general/GeneralSettingsPanel";
import { LLMSettingsPanel } from "./llm/LLMSettingsPanel";
import { McpSettingsPanel } from "./mcp/McpServerManager";
import { ReleaseChannelSettingsPanel } from "./release-channels/ReleaseChannelSettingsPanel";
import { TelemetrySettingsPanel } from "./telemetry/TelemetrySettingsPanel";
import { VideoHostSettingsPanel } from "./video-host/VideoHostSettingsPanel";

type LeaveHandler = () => Promise<boolean>;

interface SettingsTab {
  id: string;
  label: string;
}

const TABS: SettingsTab[] = [
  {
    id: "general",
    label: "General",
  },
  {
    id: "release",
    label: "Releases",
  },
  {
    id: "prompts",
    label: "Custom Prompts",
  },
  {
    id: "llm",
    label: "Model Settings",
  },
  {
    id: "mcp",
    label: "MCP Servers",
  },
  {
    id: "videoHost",
    label: "Video Host",
  },
  {
    id: "telemetry",
    label: "Telemetry",
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

const TAB_ALIASES: Record<string, string> = {
  github: "release",
  hotkeys: "general",
  language: "llm",
  toolApproval: "general",
  transcription: "llm",
};

export function SettingsDialog() {
  const [open, setOpen] = useState(false);
  const [activeTabId, setActiveTabId] = useState<string>(TABS[0]?.id ?? "release");
  const leaveHandlerRef = useRef<LeaveHandler | null>(null);

  useEffect(() => {
    const handleOpenTab = (e: Event) => {
      if (!(e instanceof CustomEvent)) {
        return;
      }

      const requestedTabId = e.detail?.tabId;
      if (typeof requestedTabId !== "string") {
        return;
      }

      const tabId = TAB_ALIASES[requestedTabId] ?? requestedTabId;
      if (!TABS.some((tab) => tab.id === tabId)) {
        return;
      }

      setOpen(true);
      setActiveTabId(tabId);
    };
    window.addEventListener("open-settings-tab", handleOpenTab);
    return () => window.removeEventListener("open-settings-tab", handleOpenTab);
  }, []);

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
        <Button
          size="chunky"
          className="flex items-center justify-start gap-2 text-white/60 bg-transparent hover:text-white hover:bg-white/10 transition-colors duration-300"
          aria-label="Open settings"
        >
          <Settings className="h-5 w-5" />
          <span className="text-xl">Settings</span>
        </Button>
      </DialogTrigger>

      <DialogContent className="w-[min(800px,72vw)] max-w-none sm:max-w-none h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader className="mb-2 flex-shrink-0">
          <DialogTitle className="text-2xl font-semibold flex items-center gap-2">
            <Settings className="h-5 w-5" />
            Settings
          </DialogTitle>
          <p className="text-muted-foreground text-sm">
            Configure YakShaver preferences and integrations.
          </p>
        </DialogHeader>

        <div className="flex gap-6 flex-1 min-h-0 overflow-hidden">
          <nav className="w-48 flex flex-col gap-1 flex-shrink-0 overflow-y-auto pr-1">
            {TABS.map((tab) => {
              const isActive = tab.id === activeTabId;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => attemptTabChange(tab.id)}
                  className={`text-left px-3 py-2.5 rounded-md transition-colors border border-transparent ${
                    isActive
                      ? "bg-white/10 border-white/20 text-white"
                      : "text-white/80 hover:bg-white/5 hover:text-white"
                  }`}
                >
                  <div className="text-sm font-medium">{tab.label}</div>
                </button>
              );
            })}
          </nav>

          <section className="flex-1 min-w-0 h-full overflow-hidden">
            <ScrollArea className="h-full">
              <div className="pb-4 pr-1">
                {activeTab?.id === "general" && (
                  <GeneralSettingsPanel isActive={open && activeTabId === "general"} />
                )}
                {activeTab?.id === "release" && (
                  <ReleaseChannelSettingsPanel isActive={open && activeTabId === "release"} />
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
                  <McpSettingsPanel isActive={open && activeTabId === "mcp"} viewMode="detailed" />
                )}
                {activeTab?.id === "videoHost" && (
                  <VideoHostSettingsPanel isActive={open && activeTabId === "videoHost"} />
                )}
                {activeTab?.id === "telemetry" && <TelemetrySettingsPanel />}
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
