import type { MCPServerConfig } from "@shared/types/mcp";

const MASKED_VALUE = "••••••••";

interface MaskedRecordProps {
  label: string;
  values: Record<string, string>;
}

function MaskedRecord({ label, values }: MaskedRecordProps) {
  const keys = Object.keys(values);
  if (keys.length === 0) {
    return null;
  }

  return (
    <>
      <dt className="text-muted-foreground leading-5">{label}</dt>
      <dd>
        <ul className="space-y-1">
          {keys.map((key) => (
            <li key={key} className="break-all font-mono text-sm leading-5">
              {key}: <span aria-hidden="true">{MASKED_VALUE}</span>
              <span className="sr-only"> value hidden</span>
            </li>
          ))}
        </ul>
      </dd>
    </>
  );
}

interface McpServerImportPreviewProps {
  configs: readonly MCPServerConfig[];
}

export function McpServerImportPreview({ configs }: McpServerImportPreviewProps) {
  return (
    <div className="rounded-md border border-border bg-card p-3">
      <h4 className="mb-2 text-sm font-medium">
        Import preview ({configs.length} server{configs.length === 1 ? "" : "s"})
      </h4>
      <div className="flex flex-col gap-3">
        {configs.map((config) => (
          <dl
            key={config.name}
            aria-label={`Import preview for ${config.name}`}
            className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 border-t border-border pt-2 text-sm first:border-t-0 first:pt-0"
          >
            <dt className="text-muted-foreground">Name</dt>
            <dd>{config.name}</dd>
            {config.description && (
              <>
                <dt className="text-muted-foreground">Description</dt>
                <dd>{config.description}</dd>
              </>
            )}
            <dt className="text-muted-foreground">Transport</dt>
            <dd>{config.transport}</dd>

            {config.transport === "streamableHttp" && (
              <>
                <dt className="text-muted-foreground">URL</dt>
                <dd className="break-all">{config.url}</dd>
                {config.headers && <MaskedRecord label="Headers" values={config.headers} />}
                {config.version && (
                  <>
                    <dt className="text-muted-foreground">Version</dt>
                    <dd>{config.version}</dd>
                  </>
                )}
                {config.timeoutMs !== undefined && (
                  <>
                    <dt className="text-muted-foreground">Timeout</dt>
                    <dd>{config.timeoutMs} ms</dd>
                  </>
                )}
              </>
            )}

            {config.transport === "stdio" && (
              <>
                <dt className="text-muted-foreground">Command</dt>
                <dd className="break-all">{config.command}</dd>
                {config.args && config.args.length > 0 && (
                  <>
                    <dt className="text-muted-foreground">Arguments</dt>
                    <dd className="break-all font-mono text-xs">{config.args.join(" ")}</dd>
                  </>
                )}
                {config.env && <MaskedRecord label="Environment" values={config.env} />}
                {config.cwd && (
                  <>
                    <dt className="text-muted-foreground">Working Directory</dt>
                    <dd className="break-all">{config.cwd}</dd>
                  </>
                )}
                {config.stderr && (
                  <>
                    <dt className="text-muted-foreground">stderr</dt>
                    <dd>{config.stderr}</dd>
                  </>
                )}
              </>
            )}
          </dl>
        ))}
      </div>
    </div>
  );
}
