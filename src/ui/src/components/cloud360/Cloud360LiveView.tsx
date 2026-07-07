import type { Cloud360EventPayload } from "@shared/types/cloud360";
import { Brain } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import Markdown from "react-markdown";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ipcClient } from "@/services/ipc-client";
import type { SandboxEvent } from "../../../../backend/services/yakshaver360/types";
import { type DisplayItem, parseLogData } from "./parse-log-data";
import { ScissorsConfetti } from "./ScissorsConfetti";

type Phase = "streaming" | "done" | "error";

function ToolResultBlock({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  let cleaned = text
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "")
    .replace(/"base64":"[A-Za-z0-9+/=]{100,}"/g, '"base64":"[image data]"')
    .replace(/"data":"[A-Za-z0-9+/=]{100,}"/g, '"data":"[image data]"')
    .trim();
  if (cleaned.includes('"type":"image"') || cleaned.includes('"media_type":"image/')) {
    cleaned = "[Image frame viewed by agent]";
  }
  if (!cleaned || cleaned.length < 3) return null;
  const preview = cleaned.split("\n")[0]?.slice(0, 80) ?? "";
  const hasMore = cleaned.length > 80 || cleaned.includes("\n");
  return (
    <div className="my-0.5 ml-6">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-1.5 text-left text-[11px] text-gray-600 hover:text-gray-400"
      >
        <span className={`transition-transform ${expanded ? "rotate-90" : ""}`}>›</span>
        <span className="truncate font-mono">{hasMore ? preview + "..." : preview}</span>
      </button>
      {expanded && (
        <pre className="mt-1 ml-5 max-h-60 overflow-y-auto border-l-2 border-gray-800 pl-3 text-[11px] leading-relaxed whitespace-pre-wrap text-gray-500">
          {cleaned}
        </pre>
      )}
    </div>
  );
}

function ThinkingBlock({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const trimmed = text.trimStart();
  const preview = trimmed.slice(0, 160) + (trimmed.length > 160 ? "..." : "");
  return (
    <div className="my-1">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="group flex w-full items-start gap-2 text-left"
      >
        <Brain className="mt-1 h-3.5 w-3.5 shrink-0 text-white/30 group-hover:text-white/60" />
        <span className="text-sm leading-relaxed whitespace-pre-wrap text-white/30 italic group-hover:text-white/60">
          {expanded ? trimmed : preview}
        </span>
      </button>
    </div>
  );
}

export function Cloud360LiveView() {
  const [items, setItems] = useState<DisplayItem[]>([]);
  const [phase, setPhase] = useState<Phase>("streaming");
  const [result, setResult] = useState<{ summary: string; artifacts: string[] } | null>(null);
  const [showConfetti, setShowConfetti] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const cleanup = ipcClient.pipelines.onCloud360Event((payload: Cloud360EventPayload) => {
      const event: SandboxEvent = payload.event;

      // A new run starts its own event stream: clear the previous run's feed
      // before appending. The backend broadcasts runStart at the top of each
      // run() so this works even when the component is not remounted.
      if (payload.runStart) {
        setItems([]);
        setResult(null);
        setShowConfetti(false);
        setPhase("streaming");
      }

      switch (event.type) {
        case "status":
          setItems((prev) => [...prev, { kind: "status", text: event.message }]);
          break;
        case "log": {
          const parsed = parseLogData(event.data, event.stream ?? "stdout");
          if (parsed.length > 0) setItems((prev) => [...prev, ...parsed]);
          break;
        }
        case "result":
          setResult({ summary: event.summary, artifacts: event.artifacts });
          if (event.artifacts.length > 0) setShowConfetti(true);
          setPhase("done");
          break;
        case "error":
          setItems((prev) => [...prev, { kind: "error", text: event.message }]);
          setPhase("error");
          break;
        // "named" / "approval-required" unused in v1.
      }
    });
    return cleanup;
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: effect only reads ref, no deps needed
  useEffect(() => {
    const viewport = scrollRef.current?.querySelector<HTMLDivElement>(
      "[data-radix-scroll-area-viewport]",
    );
    if (viewport) viewport.scrollTop = viewport.scrollHeight;
  }, [items.length]);

  const lastStatusIdx = items.map((it) => it.kind).lastIndexOf("status");
  const isStreaming = phase === "streaming";

  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-col rounded-lg border border-white/10 bg-black/20 p-4">
      <ScissorsConfetti trigger={showConfetti} />
      <h2 className="mb-2 shrink-0 text-xl">YakShaver 360 Progress</h2>
      {/* Radix ScrollArea wraps children in a display:table element that grows to
          content width, which lets non-wrapping rows (e.g. status dividers) push
          the box wider than max-w. Force that wrapper to the viewport width so
          min-w-0 / truncate below actually take effect. */}
      <ScrollArea
        ref={scrollRef}
        className="min-h-0 w-full min-w-0 flex-1 [&>[data-radix-scroll-area-viewport]>div]:!block [&>[data-radix-scroll-area-viewport]>div]:!min-w-0"
      >
        <div className="min-w-0 space-y-0.5 pr-3">
          {items.map((item, i) => {
            switch (item.kind) {
              case "status": {
                const isDone = i !== lastStatusIdx || !isStreaming;
                return (
                  // biome-ignore lint/suspicious/noArrayIndexKey: live-view items are append-only, never reordered
                  <div key={i} className="flex min-w-0 items-center gap-2 py-2">
                    <div className="h-px flex-1 bg-gray-800" />
                    <span className="flex min-w-0 items-center gap-1.5 text-[11px] font-medium text-blue-400">
                      {isDone && <span className="shrink-0 text-green-400">✓</span>}
                      <span className="truncate">{item.text}</span>
                    </span>
                    <div className="h-px flex-1 bg-gray-800" />
                  </div>
                );
              }
              case "thinking":
                // biome-ignore lint/suspicious/noArrayIndexKey: live-view items are append-only, never reordered
                return <ThinkingBlock key={i} text={item.text} />;
              case "text":
                return (
                  <div
                    // biome-ignore lint/suspicious/noArrayIndexKey: live-view items are append-only, never reordered
                    key={i}
                    className="min-w-0 py-1 text-sm leading-relaxed break-words text-neutral-400"
                  >
                    <Markdown>{item.text}</Markdown>
                  </div>
                );
              case "tool":
                return (
                  // biome-ignore lint/suspicious/noArrayIndexKey: live-view items are append-only, never reordered
                  <div key={i} className="flex min-w-0 items-center gap-2 py-1">
                    <span className="shrink-0 rounded bg-cyan-900/40 px-1.5 py-0.5 font-mono text-[10px] text-cyan-400">
                      {item.name}
                    </span>
                    <span className="truncate font-mono text-xs text-neutral-400">
                      {item.detail}
                    </span>
                  </div>
                );
              case "tool-result":
                // biome-ignore lint/suspicious/noArrayIndexKey: live-view items are append-only, never reordered
                return <ToolResultBlock key={i} text={item.text} />;
              case "result":
                return (
                  <div
                    // biome-ignore lint/suspicious/noArrayIndexKey: live-view items are append-only, never reordered
                    key={i}
                    className="min-w-0 py-2 text-sm font-medium break-words text-neutral-400"
                  >
                    <Markdown>{item.summary}</Markdown>
                  </div>
                );
              case "error":
                return (
                  // biome-ignore lint/suspicious/noArrayIndexKey: live-view items are append-only, never reordered
                  <div key={i} className="flex items-center gap-2 py-1.5 text-red-400">
                    <svg
                      className="h-4 w-4 shrink-0"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                      aria-hidden="true"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                      />
                    </svg>
                    <pre className="font-mono text-xs leading-relaxed break-all whitespace-pre-wrap">
                      {item.text}
                    </pre>
                  </div>
                );
              default:
                return null;
            }
          })}
        </div>
      </ScrollArea>

      {result && (
        <div className="mt-2 shrink-0 space-y-2 rounded-xl border border-green-800/50 bg-green-950/30 p-4">
          <h3 className="font-semibold text-green-300">Processing complete</h3>
          {result.artifacts.length > 0 && (
            <div className="space-y-1">
              <p className="text-sm text-green-400/70">Created:</p>
              {result.artifacts.map((url) => (
                <a
                  key={url}
                  href={url}
                  target="_blank"
                  rel="noreferrer"
                  className="block text-sm break-all text-blue-400 hover:underline"
                >
                  {url}
                </a>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
