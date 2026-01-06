import { AlertTriangle, Check, Play, Wrench, X } from "lucide-react";
import type React from "react";
import {
  type MCPStep,
  MCPStepType,
  type MetadataPreview,
  ProgressStage,
  STAGE_CONFIG,
  type VideoChapter,
  type WorkflowProgress,
  type WorkflowStage,
} from "../../types";
import { deepParseJson } from "../../utils";
import { AccordionContent, AccordionTrigger } from "../ui/accordion";
import { ReasoningStep } from "./ReasoningStep";

interface StageWithContentProps {
  stage: WorkflowStage;
  progress: WorkflowProgress;
  mcpSteps: MCPStep[];
  stepsRef: React.RefObject<HTMLDivElement | null>;
  getStageIcon: (stage: WorkflowStage) => React.ReactNode;
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
        Failed to generate metadata preview: {error}. Skipping metadata
        generation step.
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
  progress,
  mcpSteps,
  stepsRef,
  getStageIcon,
}: StageWithContentProps) {
  const isExternalSource = progress.sourceOrigin === "external";

  return (
    <>
      <AccordionTrigger className="px-4 hover:no-underline">
        <div className="flex items-center gap-3">
          {getStageIcon(stage)}
          <span className="text-white/90 font-medium">
            {STAGE_CONFIG[stage]}
          </span>
        </div>
      </AccordionTrigger>
      <AccordionContent className="px-4 pb-2">
        {stage === ProgressStage.TRANSCRIBING && progress.transcript && (
          <div className="p-3 bg-black/30 border border-white/10 rounded-md text-white/80 text-sm whitespace-pre-wrap break-words overflow-hidden">
            {progress.transcript}
          </div>
        )}
        {stage === ProgressStage.GENERATING_TASK &&
          progress.intermediateOutput &&
          progress.stage !== ProgressStage.GENERATING_TASK && (
            <div className="p-3 bg-black/30 border border-white/10 rounded-md text-white/80 text-xs font-mono whitespace-pre-wrap break-all overflow-hidden">
              {progress.intermediateOutput}
            </div>
          )}
        {stage === ProgressStage.EXECUTING_TASK && mcpSteps.length > 0 && (
          <div
            ref={stepsRef}
            className="bg-black/30 border border-white/10 rounded-md p-3 max-h-[400px] overflow-y-auto space-y-2"
          >
            {mcpSteps.map((step) => (
              <div
                key={step.timestamp}
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
        )}
        {stage === ProgressStage.UPDATING_METADATA && !isExternalSource && (
          <MetadataPreviewCard
            preview={progress.metadataPreview}
            error={progress.error}
          />
        )}
      </AccordionContent>
    </>
  );
}

export type { StageWithContentProps };
