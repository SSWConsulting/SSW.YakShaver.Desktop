import { Settings } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MCP_HEALTH_REFRESH_EVENT } from "../home/mcp-status";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "../ui/dialog";
import { ScrollArea } from "../ui/scroll-area";
import { AccountSettingsPanel } from "./account/AccountSettingsPanel";
import { AdvancedSettingsPanel } from "./advanced/AdvancedSettingsPanel";
import { CustomPromptSettingsPanel } from "./custom-prompt/CustomPromptManager";
import { GeneralSettingsPanel } from "./general/GeneralSettingsPanel";
import { LLMSettingsPanel } from "./llm/LLMSettingsPanel";
import { McpSettingsPanel } from "./mcp/McpServerManager";
import { ReleaseChannelSettingsPanel } from "./release-channels/ReleaseChannelSettingsPanel";
import { SettingsNavHealthIndicator } from "./SettingsNavHealthIndicator";
import { useSettingsTabHealth } from "./settings-health";
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
    id: "videoHost",
    label: "Video Host",
  },
  {
    id: "llm",
    label: "Model Settings",
  },
  {
    id: "mcp",
    label: "MCP Settings",
  },
  {
    id: "prompts",
    label: "Custom Prompts",
  },
  {
    id: "advanced",
    label: "Advanced",
  },
  {
    id: "account",
    label: "Account",
  },
  {
    id: "release",
    label: "Releases",
  },
];

const TAB_ALIASES: Record<string, string> = {
  github: "release",
  hotkeys: "general",
  language: "llm",
  telemetry: "account",
  toolApproval: "general",
  transcription: "llm",
};

export function SettingsDialog() {
  const [open, setOpen] = useState(false);
  const [activeTabId, setActiveTabId] = useState<string>(TABS[0]?.id ?? "release");
  const leaveHandlerRef = useRef<LeaveHandler | null>(null);
  const wasOpenRef = useRef(false);

  // #869 AC4: when the dialog closes (e.g. after reconnecting an MCP provider),
  // tell the Home banner to re-check provider health so it stays accurate.
  useEffect(() => {
    if (wasOpenRef.current && !open) {
      window.dispatchEvent(new CustomEvent(MCP_HEALTH_REFRESH_EVENT));
    }
    wasOpenRef.current = open;
  }, [open]);

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

  // #878 — per-tab critical configuration state for the side-nav indicators.
  const tabHealth = useSettingsTabHealth(open);

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

      <DialogContent className="w-[min(800px,72vw)] max-w-none sm:max-w-none h-[85vh] overflow-hidden flex flex-col [&_:is(button:not([role=switch]),select,input:not([type=checkbox]):not([type=radio]))]:min-h-11 [&_button:not([role=switch])]:min-w-11">
        {/* #879: the global "Settings" header was redundant with each panel's own
            title (SettingsPageHeader). It's now visually hidden — kept only for
            Radix Dialog accessibility (aria-labelledby/aria-describedby + screen
            readers). The active tab name makes the accessible title specific. */}
        <DialogHeader className="sr-only">
          <DialogTitle>{activeTab ? `Settings — ${activeTab.label}` : "Settings"}</DialogTitle>
          <DialogDescription>Configure YakShaver preferences and integrations.</DialogDescription>
        </DialogHeader>

        <div className="flex gap-6 flex-1 min-h-0 overflow-hidden">
          <nav className="w-48 flex flex-col gap-1 flex-shrink-0 overflow-y-auto pr-1">
            {TABS.map((tab) => {
              const isActive = tab.id === activeTabId;
              const health = tabHealth[tab.id];
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => attemptTabChange(tab.id)}
                  className={`group relative flex items-center justify-between gap-2 text-left px-3 py-2.5 rounded-md transition-colors border border-transparent ${
                    isActive
                      ? "bg-white/10 border-white/20 text-white"
                      : "text-white/80 hover:bg-white/5 hover:text-white"
                  }`}
                >
                  <div className="text-sm font-medium">{tab.label}</div>
                  {health ? <SettingsNavHealthIndicator health={health} /> : null}
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
