import { Copy, ExternalLink } from "lucide-react";
import { useEffect, useState } from "react";
import { useClipboard } from "../../hooks/useClipboard";
import { ipcClient } from "../../services/ipc-client";
import { ProgressStage, type WorkflowProgress } from "../../types";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";

interface ParsedResult {
  Status?: "success" | "fail";
  [key: string]: unknown;
}

interface RawTextDisplayProps {
  content: string;
}

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

  const getKey = (index: number): string => {
    return `item-${index}`;
  };

  const isValidUrl = (str: string): boolean => {
    try {
      new URL(str);
      return true;
    } catch {
      return false;
    }
  };

  const linkifyText = (text: string): React.ReactNode => {
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const parts = text.split(urlRegex);

    return (
      <>
        {parts.map((part, index) => {
          if (part.match(urlRegex)) {
            return (
              <a
                key={`link-${part}`}
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
          return <span key={`text-${part.slice(0, 20)}-${index}`}>{part}</span>;
        })}
      </>
    );
  };

  const renderValue = (value: unknown): React.ReactNode => {
    if (typeof value === "string") {
      if (isValidUrl(value)) {
        return (
          <div className="group flex items-center gap-2 p-2 bg-white/5 rounded-md border border-white/10 hover:border-white/20 transition-colors">
            <a
              href={value}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 text-sm text-blue-400 hover:text-blue-300 transition-colors break-all font-mono"
              onClick={(e) => {
                e.preventDefault();
                window.open(value, "_blank");
              }}
            >
              {value}
            </a>
            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={() => copyToClipboard(value)}
                className="p-1.5 rounded-md text-white/40 hover:text-white/80 hover:bg-white/10 transition-colors"
                title="Copy to clipboard"
              >
                <Copy className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => window.open(value, "_blank")}
                className="p-1.5 rounded-md text-white/40 hover:text-white/80 hover:bg-white/10 transition-colors"
                title="Open in browser"
              >
                <ExternalLink className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        );
      }
      // Check if text contains URLs and linkify them
      if (value.match(/(https?:\/\/[^\s]+)/g)) {
        return (
          <p className="text-sm text-white/90 leading-relaxed whitespace-pre-wrap">
            {linkifyText(value)}
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
              const itemObj = item as Record<string, unknown>;
              return (
                <div
                  key={getKey(index)}
                  className="bg-white/5 p-4 rounded-md border border-white/10"
                >
                  <div className="space-y-3">
                    {Object.entries(itemObj).map(([itemKey, itemValue]) => (
                      <div key={itemKey}>
                        <div className="flex items-baseline gap-3 mb-2">
                          <h4 className="text-xs font-semibold text-white/50 uppercase tracking-wide min-w-fit">
                            {itemKey}
                          </h4>
                          <div className="h-px flex-1 bg-white/10 self-center" />
                        </div>
                        <div className="pl-0">{renderValue(itemValue)}</div>
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
          {value.map((item, index) => (
            <div key={getKey(index)}>
              {typeof item === "object" && item !== null ? (
                renderValue(item)
              ) : typeof item === "string" ? (
                renderValue(item)
              ) : (
                <span className="text-sm text-white/90">{String(item)}</span>
              )}
            </div>
          ))}
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
  };

  return (
    <div className="space-y-4">
      {entries.map(([key, value]) => (
        <div key={key} className="group">
          <div className="flex items-baseline gap-3 mb-2">
            <h3 className="text-xs font-semibold text-white/50 uppercase tracking-wide min-w-fit">
              {key}
            </h3>
            <div className="h-px flex-1 bg-white/10 self-center" />
          </div>
          <div className="pl-0">{renderValue(value)}</div>
        </div>
      ))}
    </div>
  );
}

export function FinalResultPanel() {
  // Sample data for testing link behavior
  const sampleData = JSON.stringify({
    Status: "success",
    Title: "Test Issue Created",
    Description: "This is a test with multiple links to verify they open in default browser",
    Links: [
      "https://github.com/SSWConsulting/SSW.YakShaver.Desktop",
      "https://www.ssw.com.au",
      "https://www.google.com",
    ],
    IssueUrl: "https://github.com/SSWConsulting/SSW.YakShaver.Desktop/issues/119",
    Documentation: "Check out https://docs.github.com for more info",
  });

  const [finalOutput, setFinalOutput] = useState<string | undefined>(sampleData);

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

  const parseFinalOutput = () => {
    const raw =
      typeof finalOutput === "string" ? finalOutput : JSON.stringify(finalOutput, null, 2);
    try {
      const parsed = typeof finalOutput === "string" ? JSON.parse(finalOutput) : finalOutput;
      return { parsed, raw, isJson: true };
    } catch {
      return { parsed: null, raw, isJson: false };
    }
  };

  const { parsed, raw, isJson } = parseFinalOutput();
  const status = (isJson && parsed?.Status) as "success" | "fail" | undefined;

  return (
    <div className="w-[500px] mx-auto my-4">
      <Card className="bg-black/30 backdrop-blur-sm border-white/20 shadow-xl">
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between">
            <CardTitle className="text-white text-2xl font-semibold">Final Result</CardTitle>
            {status && (
              <span
                className={`text-sm font-medium px-3 py-1.5 rounded-full ${
                  status === "success"
                    ? "bg-green-500/20 text-green-400 border border-green-500/30"
                    : "bg-red-500/20 text-red-400 border border-red-500/30"
                }`}
              >
                {status === "success" ? "Success" : "Failed"}
              </span>
            )}
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
