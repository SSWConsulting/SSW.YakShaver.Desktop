import { Copy, ExternalLink } from "lucide-react";
import { useEffect, useState } from "react";
import { useClipboard } from "../../hooks/useClipboard";
import { ipcClient } from "../../services/ipc-client";
import { ProgressStage, type WorkflowProgress } from "../../types";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";

const URL_REGEX = /(https?:\/\/[^\s]+)/g;

interface ParsedResult {
  Status?: "success" | "fail";
  [key: string]: unknown;
}

interface RawTextDisplayProps {
  content: string;
}

const isValidUrl = (str: string): boolean => {
  try {
    new URL(str);
    return true;
  } catch {
    return false;
  }
};

const containsUrl = (text: string): boolean => {
  const regex = new RegExp(URL_REGEX.source, URL_REGEX.flags);
  return regex.test(text);
};

function RawTextDisplay({ content }: RawTextDisplayProps) {
  return (
    <div className="text-white/80 text-sm font-mono whitespace-pre-wrap bg-white/5 p-4 rounded-md border border-white/10">
      {content}
    </div>
  );
}

function JsonResultDisplay({ data }: { data: ParsedResult }) {
  const { copyToClipboard } = useClipboard();
  const entries = Object.entries(data).filter(([key]) => key !== "Status" && key !== "IssueNumber");

  return (
    <div className="space-y-4">
      {entries.map(([key, value]) => (
        <div key={key}>
          <SectionHeader title={key} />
          <ValueRenderer value={value} onCopy={copyToClipboard} />
        </div>
      ))}
    </div>
  );
}

interface LinkActionButtonsProps {
  url: string;
  onCopy: (text: string) => void;
}

function LinkActionButtons({ url, onCopy }: LinkActionButtonsProps) {
  return (
    <div className="flex items-center gap-1 shrink-0">
      <button
        type="button"
        onClick={() => onCopy(url)}
        className="p-1.5 rounded-md text-white/40 hover:text-white/80 hover:bg-white/10 transition-colors"
        title="Copy to clipboard"
      >
        <Copy className="w-3.5 h-3.5" />
      </button>
      <button
        type="button"
        onClick={() => window.open(url, "_blank")}
        className="p-1.5 rounded-md text-white/40 hover:text-white/80 hover:bg-white/10 transition-colors"
        title="Open in browser"
      >
        <ExternalLink className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

interface LinkifiedTextProps {
  text: string;
}

function LinkifiedText({ text }: LinkifiedTextProps) {
  const regex = new RegExp(URL_REGEX.source, URL_REGEX.flags);
  const parts = text.split(regex);

  return (
    <>
      {parts.map((part, index) => {
        const isUrl = regex.test(part);
        // Reset regex after test
        regex.lastIndex = 0;

        if (isUrl || part.match(/^https?:\/\//)) {
          return (
            <a
              key={`link-${part.slice(0, 50)}-${index}`}
              href={part}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-400 hover:text-blue-300 underline"
              onClick={(e) => {
                e.preventDefault();
                window.open(part, "_blank");
              }}
            >
              {part}
            </a>
          );
        }
        return part ? <span key={`text-${part.slice(0, 50)}-${index}`}>{part}</span> : null;
      })}
    </>
  );
}

interface UrlDisplayProps {
  url: string;
  onCopy: (text: string) => void;
}

function UrlDisplay({ url, onCopy }: UrlDisplayProps) {
  return (
    <div className="group flex items-center gap-2 p-2 bg-white/5 rounded-md border border-white/10 hover:border-white/20 transition-colors">
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="flex-1 text-sm text-blue-400 hover:text-blue-300 transition-colors break-all font-mono"
        onClick={(e) => {
          e.preventDefault();
          window.open(url, "_blank");
        }}
      >
        {url}
      </a>
      <LinkActionButtons url={url} onCopy={onCopy} />
    </div>
  );
}

interface SectionHeaderProps {
  title: string;
}

function SectionHeader({ title }: SectionHeaderProps) {
  return (
    <div className="flex items-baseline gap-3 mb-2">
      <h3 className="text-xs font-semibold text-white/50 uppercase tracking-wide min-w-fit">
        {title}
      </h3>
      <div className="h-px flex-1 bg-white/10 self-center" />
    </div>
  );
}

interface ValueRendererProps {
  value: unknown;
  onCopy: (text: string) => void;
}

function ValueRenderer({ value, onCopy }: ValueRendererProps): React.ReactNode {
  if (typeof value === "string") {
    if (isValidUrl(value)) {
      return <UrlDisplay url={value} onCopy={onCopy} />;
    }
    if (containsUrl(value)) {
      return (
        <p className="text-sm text-white/90 leading-relaxed whitespace-pre-wrap">
          <LinkifiedText text={value} />
        </p>
      );
    }
    return <p className="text-sm text-white/90 leading-relaxed whitespace-pre-wrap">{value}</p>;
  }

  if (Array.isArray(value)) {
    // Check if array contains objects (like multiple issues)
    if (value.length > 0 && typeof value[0] === "object" && value[0] !== null) {
      return (
        <div className="space-y-3">
          {value.map((item, index) => {
            const itemKey = `obj-${JSON.stringify(item).slice(0, 50)}-${index}`;
            return (
              <div key={itemKey} className="bg-white/5 p-4 rounded-md border border-white/10">
                <div className="space-y-3">
                  {Object.entries(item as Record<string, unknown>).map(([itemKey, itemValue]) => (
                    <div key={itemKey}>
                      <SectionHeader title={itemKey} />
                      <ValueRenderer value={itemValue} onCopy={onCopy} />
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      );
    }

    return (
      <div className="space-y-2">
        {value.map((item, index) => {
          const itemKey =
            typeof item === "string"
              ? `item-${item.slice(0, 50)}-${index}`
              : `item-${String(item).slice(0, 50)}-${index}`;
          return (
            <div key={itemKey}>
              <ValueRenderer value={item} onCopy={onCopy} />
            </div>
          );
        })}
      </div>
    );
  }

  if (typeof value === "object" && value !== null) {
    return (
      <pre className="text-xs font-mono text-white/70 whitespace-pre-wrap bg-white/5 p-3 rounded-md border border-white/10">
        {JSON.stringify(value, null, 2)}
      </pre>
    );
  }

  if (typeof value === "number") {
    return <span className="text-sm text-white/90 font-mono">{value}</span>;
  }

  return <span className="text-sm text-white/70">{String(value)}</span>;
}

interface StatusBadgeProps {
  status: "success" | "fail";
}

function StatusBadge({ status }: StatusBadgeProps) {
  const isSuccess = status === "success";
  return (
    <span
      className={`text-sm font-medium px-3 py-1.5 rounded-full ${
        isSuccess
          ? "bg-green-500/20 text-green-400 border border-green-500/30"
          : "bg-red-500/20 text-red-400 border border-red-500/30"
      }`}
    >
      {isSuccess ? "Success" : "Failed"}
    </span>
  );
}

const parseFinalOutput = (
  finalOutput: string | undefined,
): { parsed: ParsedResult | null; raw: string; isJson: boolean } => {
  if (!finalOutput) {
    return { parsed: null, raw: "", isJson: false };
  }

  const raw = typeof finalOutput === "string" ? finalOutput : JSON.stringify(finalOutput, null, 2);

  try {
    const parsed = typeof finalOutput === "string" ? JSON.parse(finalOutput) : finalOutput;
    return { parsed, raw, isJson: true };
  } catch {
    return { parsed: null, raw, isJson: false };
  }
};

export function FinalResultPanel() {
  const [finalOutput, setFinalOutput] = useState<string | undefined>();

  useEffect(() => {
    return ipcClient.workflow.onProgress((data: unknown) => {
      const progressData = data as WorkflowProgress;
      if (progressData.finalOutput) {
        setFinalOutput(progressData.finalOutput);
      } else if (
        progressData.stage === ProgressStage.IDLE ||
        progressData.stage === ProgressStage.CONVERTING_AUDIO
      ) {
        setFinalOutput(undefined);
      }
    });
  }, []);

  if (!finalOutput) return null;

  const { parsed, raw, isJson } = parseFinalOutput(finalOutput);
  const status = (isJson && parsed?.Status) as "success" | "fail" | undefined;

  return (
    <div className="w-[500px] mx-auto my-4">
      <Card className="bg-black/30 backdrop-blur-sm border-white/20 shadow-xl">
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between">
            <CardTitle className="text-white text-2xl font-semibold">Final Result</CardTitle>
            {status && <StatusBadge status={status} />}
          </div>
        </CardHeader>
        <CardContent className="pt-2">
          {isJson && parsed ? (
            <JsonResultDisplay data={parsed} />
          ) : (
            <RawTextDisplay content={raw} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
