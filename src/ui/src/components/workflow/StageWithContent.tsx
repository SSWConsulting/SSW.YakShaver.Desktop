import { AlertTriangle, Check, Play, Wrench, X } from "lucide-react";
import type React from "react";
import {
  type MCPStep,
  MCPStepType,
  type MetadataPreview,
  type VideoChapter,
} from "../../types";
import { deepParseJson } from "../../utils";
import { ReasoningStep } from "./ReasoningStep";

interface StageWithContentProps {
  stage: string;
  payload: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

const handleDetailsToggle =
  (data: unknown) => (e: React.SyntheticEvent<HTMLDetailsElement>) => {
    const details = e.currentTarget;
    if (details.open) {
      const pre = details.querySelector("pre");
      if (pre && !pre.dataset.parsed) {
        pre.textContent = JSON.stringify(deepParseJson(data), null, 2);
        pre.dataset.parsed = "true";
      }
    }
  };

function ToolResultError({ error }: { error: string }) {
  return (
    <div className="text-red-400 flex items-center gap-1">
      <X className="w-3 h-3" />
      Error: {error}
    </div>
  );
}

function ToolResultSuccess({ result }: { result: unknown }) {
  return (
    <div className="space-y-1">
      {result !== undefined && result !== null && (
        <details className="text-xs" onToggle={handleDetailsToggle(result)}>
          <summary className="text-zinc-400 cursor-pointer hover:text-zinc-400/80">
            View result
          </summary>
          <pre className="mt-1 p-2 bg-black rounded text-zinc-400 overflow-x-auto max-h-[200px] overflow-y-auto whitespace-pre-wrap break-all">
            Loading...
          </pre>
        </details>
      )}
    </div>
  );
}

function ToolApprovalPending({ toolName }: { toolName?: string }) {
  return (
    <div className="text-amber-300 flex items-center gap-2">
      <AlertTriangle className="w-4 h-4" />
      Waiting for approval to run {toolName ?? "the requested tool"}
    </div>
  );
}

function ToolDeniedNotice({ message }: { message?: string }) {
  return (
    <div className="text-red-400 flex items-center gap-2">
      <X className="w-3 h-3" />
      <span className="whitespace-pre-line">
        {message ?? "Tool execution denied"}
      </span>
    </div>
  );
}

function MetadataPreviewCard({
  preview,
  error,
}: {
  preview?: MetadataPreview;
  error?: string;
}) {
  if (error) {
    return (
      <div className="p-3 bg-black/30 border border-white/10 rounded-md text-white/80 text-sm">
        Failed to update metadata: {error}. Skipping metadata update step.
      </div>
    );
  }

  if (!preview) {
    return (
      <div className="p-3 bg-black/30 border border-white/10 rounded-md text-white/80 text-sm">
        Generating YouTube title, description, and chapters...
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <MetadataField label="Title">
        <p className="text-white font-semibold">{preview.title}</p>
      </MetadataField>
      <MetadataField label="Description">
        <pre className="text-sm text-white/80 whitespace-pre-wrap break-words font-sans overflow-hidden">
          {preview.description}
        </pre>
      </MetadataField>
      {preview.tags && preview.tags.length > 0 && (
        <MetadataField label="Tags">
          <div className="flex flex-wrap gap-2">
            {preview.tags.map((tag) => (
              <span
                key={tag}
                className="text-xs uppercase tracking-wide px-2 py-1 rounded-full bg-white/10 text-white/80"
              >
                {tag}
              </span>
            ))}
          </div>
        </MetadataField>
      )}
      {preview.chapters && preview.chapters.length > 0 && (
        <MetadataField label="Chapters">
          <div className="space-y-1">
            {preview.chapters.map((chapter) => (
              <ChapterRow
                key={`${chapter.timestamp}-${chapter.label}`}
                chapter={chapter}
              />
            ))}
          </div>
        </MetadataField>
      )}
    </div>
  );
}

function MetadataField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="p-3 bg-black/30 border border-white/10 rounded-md space-y-2">
      <p className="text-xs uppercase tracking-wide text-white/50">{label}</p>
      {children}
    </div>
  );
}

function ChapterRow({ chapter }: { chapter: VideoChapter }) {
  const timestamp = chapter.timestamp;
  return (
    <div className="flex items-center gap-3 text-sm text-white/80">
      <span className="font-mono text-white/60">{timestamp}</span>
      <span>{chapter.label}</span>
    </div>
  );
}

function ToolCallStep({
  toolName,
  serverName,
  args,
}: {
  toolName?: string;
  serverName?: string;
  args?: unknown;
}) {
  const hasArgs =
    typeof args === "object" &&
    args !== null &&
    !Array.isArray(args) &&
    Object.keys(args).length > 0;

  return (
    <div className="space-y-1">
      <div className="font-medium flex items-center gap-2">
        <Wrench className="w-4 h-4" />
        Calling tool: {toolName}
        {serverName && (
          <span className="text-zinc-400 text-xs ml-2">
            (from {serverName})
          </span>
        )}
      </div>
      {hasArgs && (
        <details className="ml-4 text-xs" onToggle={handleDetailsToggle(args)}>
          <summary className="text-zinc-400 cursor-pointer hover:text-zinc-400/80">
            Arguments
          </summary>
          <pre className="mt-1 p-2 bg-black rounded text-zinc-400 overflow-x-auto whitespace-pre-wrap break-all">
            Loading...
          </pre>
        </details>
      )}
    </div>
  );
}

export function StageWithContent({
  stage,
  payload,
}: StageWithContentProps) {
  // If no payload or empty object, nothing to render
  if (!payload) return null;
  
  // Handing executing_task (MCP Steps)
  if (stage === "executing_task" && isRecord(payload) && Array.isArray(payload.steps)) {
    const mcpSteps = payload.steps as MCPStep[];
    
    return (
      <div className="max-h-[400px] overflow-y-auto space-y-2">
        {mcpSteps.map((step, idx) => (
          <div
            // timestamp might be undefined or duplicated, using index as fallback
            key={`${step.timestamp}-${idx}`}
            className="border-l-2 border-green-400/30 pl-3 py-1"
          >
            {step.type === MCPStepType.START && (
              <div className="text-secondary font-medium flex items-center gap-2">
                <Play className="w-4 h-4" />
                {step.message || "Start task execution"}
              </div>
            )}
            {step.type === MCPStepType.REASONING && step.reasoning && (
              <ReasoningStep reasoning={step.reasoning} />
            )}
            {step.type === MCPStepType.TOOL_CALL && (
              <ToolCallStep
                toolName={step.toolName}
                serverName={step.serverName}
                args={step.args}
              />
            )}
            {step.type === MCPStepType.TOOL_APPROVAL_REQUIRED && (
              <div className="space-y-1">
                <ToolApprovalPending toolName={step.toolName} />
                <ToolCallStep
                  toolName={step.toolName}
                  serverName={step.serverName}
                  args={step.args}
                />
              </div>
            )}
            {step.type === MCPStepType.TOOL_RESULT && (
              <div className="ml-4 space-y-1">
                {step.error ? (
                  <ToolResultError error={step.error} />
                ) : (
                  <ToolResultSuccess result={step.result} />
                )}
              </div>
            )}
            {step.type === MCPStepType.TOOL_DENIED && (
              <div className="ml-4">
                <ToolDeniedNotice message={step.message} />
              </div>
            )}
            {step.type === MCPStepType.FINAL_RESULT && (
              <div className="font-medium flex items-center gap-2">
                <Check className="w-4 h-4" />
                {step.message || "Generated final result"}
              </div>
            )}
          </div>
        ))}
      </div>
    );
  }

  if (stage === "transcribing" && typeof payload === 'string') {
      return (
         <div className="text-sm whitespace-pre-wrap break-words overflow-hidden">
             {payload}
         </div>
      );
  }
  
  if (stage === "transcribing" && isRecord(payload) && typeof payload.transcriptText === 'string') {
      return (
          <div className="text-sm whitespace-pre-wrap break-words overflow-hidden">
              {payload.transcriptText}
          </div>
      );
  }

  if (stage === "updating_metadata" && isRecord(payload)) {
      const preview = isRecord(payload.metadataPreview) ? (payload.metadataPreview as unknown as MetadataPreview) : undefined;
      const error = typeof payload.metadataUpdateError === 'string' ? payload.metadataUpdateError : (typeof payload.error === 'string' ? payload.error : undefined);
      
      if (preview || error) {
        return (
            <MetadataPreviewCard
              preview={preview}
              error={error}
            />
          );
      }
  }
  
  if (stage === "analyzing_transcript" || stage === "executing_task" ) {
      // Could be intermediate output or other json
      if (isRecord(payload) && payload.intermediateOutput) {
           return (
             <div className="text-xs font-mono whitespace-pre-wrap break-all overflow-hidden">
                {typeof payload.intermediateOutput === 'string' ? payload.intermediateOutput : JSON.stringify(payload.intermediateOutput, null, 2)}
             </div>
           );
      }
  }

  // Fallback to JSON view
  return (
     <div className="text-xs font-mono whitespace-pre-wrap break-all overflow-hidden">
         {typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2)}
     </div>
  );
}
