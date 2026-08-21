import { randomUUID } from "node:crypto";
import { asSchema, type ToolSet } from "ai";
import { PRESET_SERVER_IDS } from "../../../shared/mcp/preset-servers";
import type { MCPServerConfig } from "../../../shared/types/mcp";

/**
 * Reads the CURRENT title of a backlog work item straight from the system that owns it.
 *
 * Why this module exists: once a work item exists, YakShaver is no longer the authority on its
 * title. A duplicate update, a title the agent adapted to a repository template, or a later manual
 * rename all live in GitHub/Azure DevOps/Jira, not here. Everything YakShaver owns (the Shave
 * record, the portal payload, YakShaver-uploaded video metadata) is reconciled against what this
 * module reads back.
 *
 * The platform-specific parts — which URL shapes are recognised, which read tool to call, how a
 * title is spelled in each response — are deliberately contained HERE. Callers only ever hand over
 * a URL and receive a title or a classified failure.
 */

export type BacklogPlatform = "github" | "azure-devops" | "jira";

export type BacklogResolveFailure =
  /** The URL is not a work item on a platform this module knows how to read. */
  | "unsupported_url"
  /** No enabled/selected MCP server exposes a read tool for that platform. */
  | "no_read_tool"
  /** A tool was found, but its name implies it can mutate — refused rather than executed. */
  | "refused_mutation_tool"
  /** The platform answered, but the item is gone (or the URL was never right). Do NOT retry. */
  | "not_found"
  /** The MCP connection is signed out or lacks access. Retry after the user reconnects. */
  | "unauthenticated"
  /** The item exists but is deleted/removed. Do NOT retry. */
  | "deleted"
  /** Anything else — a network blip, a rate limit, an unreadable response. Safe to retry. */
  | "transient";

export type BacklogItemResolution =
  | { ok: true; platform: BacklogPlatform; title: string }
  | { ok: false; reason: BacklogResolveFailure; detail?: string };

export interface BacklogItemResolver {
  /**
   * @param url  The work item link, exactly as the "View work item" action uses it.
   * @param serverFilter  The project's selected MCP servers, so reconciliation reads through the
   *   same identity and the same server restriction the run itself used.
   */
  resolveAsync(url: string, serverFilter?: string[]): Promise<BacklogItemResolution>;
}

/**
 * The slice of {@link MCPServerManager} this module needs. Kept narrow so the resolver can be
 * unit-tested with a plain object instead of live MCP clients.
 */
export interface ResolverToolProvider {
  collectToolsForSelectedServersAsync(serverIds?: string[]): Promise<ToolSet>;
  /** Server configs, so a server is matched to its platform by WHAT IT IS, not by what it is called. */
  listAvailableServers(): Promise<MCPServerConfig[]>;
}

interface BacklogItemRef {
  platform: BacklogPlatform;
  /** URL-derived values, keyed by the ROLE they play rather than by any one server's parameter name. */
  values: Record<string, string>;
}

/**
 * Recognise a work item URL and pull out the values a read call needs.
 *
 * Only the hosted URL shapes are matched. A self-hosted GitHub Enterprise or Jira Data Center URL
 * falls through to `unsupported_url`, which leaves the existing title untouched — the same outcome
 * as before reconciliation existed, and a visible one via the returned reason.
 */
export function parseBacklogItemUrl(rawUrl: string): BacklogItemRef | undefined {
  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    return undefined;
  }

  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  const segments = url.pathname.split("/").filter(Boolean);

  // https://github.com/{owner}/{repo}/issues/{number}
  if (host === "github.com") {
    const [owner, repo, kind, number] = segments;
    if (owner && repo && kind === "issues" && number && /^\d+$/.test(number)) {
      return { platform: "github", values: { owner, repo, number } };
    }
    return undefined;
  }

  // https://dev.azure.com/{org}/{project}/_workitems/edit/{id}
  // https://{org}.visualstudio.com/{project}/_workitems/edit/{id}
  // The two hosts differ only in WHERE the organization lives — a path segment vs. the hostname —
  // and on both the project segment is optional, because an org-level link omits it.
  const isAzureDevOps = host === "dev.azure.com" || host.endsWith(".visualstudio.com");
  if (isAzureDevOps) {
    const editIndex = segments.findIndex((segment) => segment.toLowerCase() === "_workitems");
    const id = segments[editIndex + 2];
    // On dev.azure.com the organization occupies segment 0, so `_workitems` can never be first;
    // on the legacy host the organization is in the hostname, so an org-level link starts with it.
    const projectIndex = host === "dev.azure.com" ? 1 : 0;
    if (editIndex >= projectIndex && id && /^\d+$/.test(id)) {
      const organization = host === "dev.azure.com" ? segments[0] : host.split(".")[0];
      // Absent on an org-level link, and then genuinely omitted: passing the organization in the
      // project's place would send the reader looking in a project that does not exist. A tool that
      // requires `project` fails its own validation instead, which keeps the existing title.
      const project = editIndex > projectIndex ? segments[projectIndex] : undefined;
      return {
        platform: "azure-devops",
        values: { organization, id, ...(project ? { project } : {}) },
      };
    }
    return undefined;
  }

  // https://{site}.atlassian.net/browse/{KEY-123}
  if (host.endsWith(".atlassian.net")) {
    const browseIndex = segments.findIndex((segment) => segment.toLowerCase() === "browse");
    const key = segments[browseIndex + 1];
    if (browseIndex >= 0 && key && /^[A-Za-z][A-Za-z0-9_]*-\d+$/.test(key)) {
      return { platform: "jira", values: { key } };
    }
    return undefined;
  }

  return undefined;
}

/**
 * Tools that carry a backlog noun + a read verb but do NOT return the item itself, so picking one
 * would read a title that isn't there and report a bogus `transient`.
 */
const NON_ITEM_READ_TOOL =
  /(comment|search|list|history|attachment|relation|link|type|field|batch|query|template)/;

/** Last-resort signal: the server's NAME mentions the platform. Only used when nothing better does. */
const PLATFORM_NAME_HINT: Record<BacklogPlatform, RegExp> = {
  github: /github/,
  "azure-devops": /(azure|devops|ado)/,
  jira: /(jira|atlassian)/,
};

/** The hosts and stdio packages that identify a server regardless of what the user named it. */
const PLATFORM_ENDPOINT_HINT: Record<BacklogPlatform, RegExp> = {
  github: /(githubcopilot\.com|\bgithub\b)/,
  "azure-devops": /(dev\.azure\.com|visualstudio\.com|azure-devops|azuredevops)/,
  jira: /(atlassian\.com|\bjira\b)/,
};

const PLATFORM_ITEM_NOUN: Record<BacklogPlatform, RegExp> = {
  github: /issue/,
  "azure-devops": /work[_-]?item/,
  jira: /issue/,
};

/** Preset servers are identified by id, which survives the user renaming them in Settings. */
const PRESET_SERVER_PLATFORMS: Record<string, BacklogPlatform> = {
  [PRESET_SERVER_IDS.GITHUB]: "github",
  [PRESET_SERVER_IDS.AZURE_DEVOPS]: "azure-devops",
  [PRESET_SERVER_IDS.JIRA]: "jira",
};

/**
 * Decide which platform a configured MCP server talks to, strongest signal first:
 *
 *  1. its preset id — exact, and unaffected by renaming;
 *  2. its endpoint — the HTTP host, or the package a stdio server launches;
 *  3. its name — the weakest signal, and the only one a hand-rolled server usually offers.
 *
 * Identifying by endpoint matters because two of the three platforms spell their read tool
 * identically (`get_issue`): without knowing which server a tool came from, a Jira issue could be
 * read to "confirm" a GitHub URL. A server we cannot place yields no match at all, which surfaces
 * as `no_read_tool` — a visible non-answer instead of a confident wrong one.
 */
export function identifyServerPlatform(config: MCPServerConfig): BacklogPlatform | undefined {
  const preset = PRESET_SERVER_PLATFORMS[config.id];
  if (preset) {
    return preset;
  }

  const endpoint = [
    config.transport === "streamableHttp" ? config.url : "",
    config.transport === "stdio" ? `${config.command} ${(config.args ?? []).join(" ")}` : "",
  ]
    .join(" ")
    .toLowerCase();

  const byEndpoint = (Object.keys(PLATFORM_ENDPOINT_HINT) as BacklogPlatform[]).find((platform) =>
    PLATFORM_ENDPOINT_HINT[platform].test(endpoint),
  );
  if (byEndpoint) {
    return byEndpoint;
  }

  const name = config.name.toLowerCase();
  return (Object.keys(PLATFORM_NAME_HINT) as BacklogPlatform[]).find((platform) =>
    PLATFORM_NAME_HINT[platform].test(name),
  );
}

/**
 * Map each server's tool prefix to its platform. The prefix is the server name with whitespace
 * collapsed to underscores (see `listToolsWithServerPrefixAsync`), so it is reproduced the same way
 * here rather than assumed to equal the configured name.
 */
export function mapServerPrefixesToPlatforms(
  configs: readonly MCPServerConfig[],
): Map<string, BacklogPlatform> {
  const prefixes = new Map<string, BacklogPlatform>();
  for (const config of configs) {
    const platform = identifyServerPlatform(config);
    if (platform) {
      prefixes.set(config.name.replace(/\s+/g, "_").toLowerCase(), platform);
    }
  }
  return prefixes;
}

/**
 * Pick the read tool for a platform out of the aggregated, server-prefixed toolset.
 *
 * `serverPlatforms` is authoritative when it knows the prefix; a prefix it does not cover falls
 * back to reading the platform out of the tool name itself, which keeps a server whose config could
 * not be listed working exactly as before.
 */
export function selectReadToolName(
  tools: ToolSet,
  platform: BacklogPlatform,
  serverPlatforms: ReadonlyMap<string, BacklogPlatform> = new Map(),
): string | undefined {
  const itemNoun = PLATFORM_ITEM_NOUN[platform];

  for (const name of Object.keys(tools)) {
    const { prefix, bare } = splitToolName(name);

    const knownPlatform = serverPlatforms.get(prefix);
    const servesPlatform = knownPlatform
      ? knownPlatform === platform
      : PLATFORM_NAME_HINT[platform].test(prefix);

    if (!servesPlatform || !itemNoun.test(bare) || NON_ITEM_READ_TOOL.test(bare)) {
      continue;
    }
    if (/(get|read|show|view|detail)/.test(bare)) {
      return name;
    }
  }

  return undefined;
}

/** The `<server>__` prefix the orchestrator adds, and the bare operation name underneath it. */
function splitToolName(toolName: string): { prefix: string; bare: string } {
  const normalized = toolName.toLowerCase();
  const [prefix, ...rest] = normalized.split("__");
  return { prefix, bare: rest.length > 0 ? rest.join("__") : normalized };
}

/**
 * Verbs that say a tool can change something. Matched as substrings rather than as whole tokens,
 * because real servers both separate the words (`update_issue`) and run them together
 * (`editjiraissue`).
 */
const MUTATION_VERB = /(create|update|edit|write|new|add|delete|remove|close|reopen|transition)/;

/**
 * A BACKSTOP against an oddly named tool — deliberately not claimed as an independent boundary.
 *
 * `selectReadToolName` already requires a read verb, and that requirement is what keeps
 * `create_issue`, `issue_write` and `wit_update_work_item` from ever being picked. What this adds is
 * the one shape that requirement cannot see: a name carrying a read verb AND a write verb, such as
 * `get_or_update_issue`, `issue_read_write` or `update_issue_details`.
 *
 * Deliberately a denylist of write verbs rather than an allowlist of read-only shapes. An allowlist
 * would have to enumerate every vendor's vocabulary — `wit_`, `jira_`, whatever ships next — and one
 * word it did not know would silently disable reconciliation for that whole platform, visible only
 * in telemetry. A verb THIS list misses is still bounded by the read-verb requirement above; a
 * reader an allowlist wrongly rejects is bounded by nothing.
 *
 * Owned here rather than borrowed from `isBacklogItemMutationTool`, which answers a different
 * question ("does this author a body?", #834) and therefore reports `delete_issue` and `close_issue`
 * as non-mutations. Tuning that regex for its own purpose must not move this check.
 */
export function isReadOnlyItemToolName(toolName: string): boolean {
  return !MUTATION_VERB.test(splitToolName(toolName).bare);
}

/**
 * The parameter name each URL-derived value is known by on the servers we target. Filling the
 * tool's DECLARED parameters (rather than hardcoding one server's spelling) is what lets the same
 * code drive GitHub's action-based `issue_read` and the legacy `get_issue` without a per-server
 * branch — whichever variant is installed, we fill the names it actually asks for.
 *
 * Matching is case- and separator-insensitive, so one entry already covers `issue_number` and
 * `issueNumber`. Every entry here is a name a real server is known to use; ADD MORE ONLY FROM AN
 * OBSERVED SCHEMA. Inventing plausible spellings would claim a coverage that has never been
 * exercised, and an unmatched parameter degrades safely — the read fails and the title is kept.
 */
const VALUE_PARAMETER_NAMES: Record<string, readonly string[]> = {
  owner: ["owner"],
  repo: ["repo"],
  number: ["issue_number"],
  organization: ["organization"],
  project: ["project"],
  id: ["id"],
  key: ["issueIdOrKey"],
};

/**
 * A read has no side effect to authorise, so an action-based tool's "which operation" parameter is
 * always a get. `method` is the spelling the GitHub remote server uses for its `issue_read` /
 * `issue_write` pair; same rule as above applies to adding others.
 */
const OPERATION_PARAM = /^method$/;
const OPERATION_READ_VALUE = /^(get|read|show|view|detail)/;

interface JsonSchemaLike {
  properties?: Record<string, unknown>;
}

/**
 * Build the tool arguments by matching URL-derived values against the tool's declared parameters.
 * Unknown parameters are left out entirely — a required one we cannot fill surfaces as the tool's
 * own validation error, which classifies as `transient` and keeps the existing title.
 */
export function buildReadToolArgs(
  schema: JsonSchemaLike,
  values: Record<string, string>,
): Record<string, unknown> {
  const properties = schema.properties ?? {};
  const args: Record<string, unknown> = {};

  for (const [propertyName, propertySchema] of Object.entries(properties)) {
    const normalized = propertyName.toLowerCase().replace(/[^a-z0-9]/g, "");

    const matchedRole = Object.keys(values).find((role) =>
      (VALUE_PARAMETER_NAMES[role] ?? [role]).some(
        (candidate) => candidate.toLowerCase().replace(/[^a-z0-9]/g, "") === normalized,
      ),
    );
    if (matchedRole) {
      const raw = values[matchedRole];
      args[propertyName] = isNumericParameter(propertySchema) ? Number(raw) : raw;
      continue;
    }

    if (OPERATION_PARAM.test(normalized)) {
      const readValue = readOperationValue(propertySchema);
      if (readValue) {
        args[propertyName] = readValue;
      }
    }
  }

  return args;
}

function isNumericParameter(propertySchema: unknown): boolean {
  if (!propertySchema || typeof propertySchema !== "object") {
    return false;
  }
  const type = (propertySchema as { type?: unknown }).type;
  return type === "number" || type === "integer";
}

function readOperationValue(propertySchema: unknown): string | undefined {
  if (!propertySchema || typeof propertySchema !== "object") {
    return undefined;
  }
  const enumValues = (propertySchema as { enum?: unknown }).enum;
  if (!Array.isArray(enumValues)) {
    return undefined;
  }
  return enumValues.find(
    (value): value is string =>
      typeof value === "string" && OPERATION_READ_VALUE.test(value.toLowerCase()),
  );
}

/** How each platform spells a title in a read response. */
const TITLE_KEYS = ["title", "summary", "system.title"];

/**
 * Pull the item title out of a read response. MCP servers answer with JSON text, but the exact
 * envelope differs (bare item, `{fields:{...}}`, `{value:[{...}]}`), so this walks for a title
 * key rather than assuming one shape.
 */
export function extractItemTitle(resultText: string): string | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(resultText);
  } catch {
    return undefined;
  }
  return findTitle(parsed, 0);
}

function findTitle(value: unknown, depth: number): string | undefined {
  if (depth > 5 || value === null || typeof value !== "object") {
    return undefined;
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      const title = findTitle(entry, depth + 1);
      if (title) return title;
    }
    return undefined;
  }

  for (const [key, nested] of Object.entries(value)) {
    if (TITLE_KEYS.includes(key.toLowerCase()) && typeof nested === "string" && nested.trim()) {
      return nested.trim();
    }
  }

  for (const nested of Object.values(value)) {
    const title = findTitle(nested, depth + 1);
    if (title) return title;
  }

  return undefined;
}

/**
 * Classify a failed read so the caller can tell "this will never work" from "try again later".
 * Retrying a deleted item forever is as wrong as giving up on a rate limit.
 */
export function classifyReadFailure(text: string): BacklogResolveFailure {
  const message = text.toLowerCase();
  if (/(401|403|unauthor|forbidden|sign in|signed out|authenticat|token)/.test(message)) {
    return "unauthenticated";
  }
  if (/(deleted|removed|recycle bin)/.test(message)) {
    return "deleted";
  }
  if (/(404|not found|does not exist|no such)/.test(message)) {
    return "not_found";
  }
  return "transient";
}

type ToolExecute = (
  input: unknown,
  options: { toolCallId: string; messages: unknown[] },
) => Promise<unknown> | unknown;

export class McpBacklogItemResolver implements BacklogItemResolver {
  constructor(private readonly provider: ResolverToolProvider) {}

  async resolveAsync(url: string, serverFilter?: string[]): Promise<BacklogItemResolution> {
    const ref = parseBacklogItemUrl(url);
    if (!ref) {
      return { ok: false, reason: "unsupported_url", detail: url };
    }

    let tools: ToolSet;
    try {
      tools = await this.provider.collectToolsForSelectedServersAsync(serverFilter);
    } catch (error) {
      // Zero healthy servers throws here. That is a "come back later" state, not a broken URL.
      return { ok: false, reason: "transient", detail: errorText(error) };
    }

    // Listing configs is what lets a renamed or hand-rolled server still be placed. Failing to
    // list them is not fatal — tool-name matching still covers the conventionally named servers.
    let serverPlatforms: ReadonlyMap<string, BacklogPlatform> = new Map();
    try {
      serverPlatforms = mapServerPrefixesToPlatforms(await this.provider.listAvailableServers());
    } catch (error) {
      console.warn(
        "[BacklogItemResolver] Could not list MCP servers; falling back to tool-name matching:",
        errorText(error),
      );
    }

    const toolName = selectReadToolName(tools, ref.platform, serverPlatforms);
    if (!toolName) {
      return { ok: false, reason: "no_read_tool", detail: ref.platform };
    }

    // Backstop for the shape the read-verb requirement above cannot see: a name that carries both
    // verbs, e.g. `get_or_update_issue`. Not an independent boundary — two checks against the same
    // string are one kind of evidence — but it decides something for every name, which is the point.
    if (!isReadOnlyItemToolName(toolName)) {
      console.warn(
        `[BacklogItemResolver] Refusing to reconcile through '${toolName}': its name implies a mutation.`,
      );
      return { ok: false, reason: "refused_mutation_tool", detail: toolName };
    }

    const tool = tools[toolName];
    const execute = (tool as { execute?: unknown }).execute;
    if (typeof execute !== "function") {
      return { ok: false, reason: "no_read_tool", detail: toolName };
    }

    // NOTE: this deliberately does NOT go through McpToolBridge's approval policy. That policy
    // gates tools the MODEL chose to run; this is a read the app itself issues, and routing it
    // through `ask` mode would deny reconciliation to every user who has not whitelisted a read
    // tool. The exemption rests on two boundaries, both enforced above: the target must parse as a
    // work item URL on a known host (so the model cannot steer the read anywhere it likes), and the
    // tool is chosen by us rather than by the model — chosen, specifically, by requiring a read verb
    // in its name, which is what excludes `create_issue` / `issue_write` / `wit_update_work_item`.
    // `isReadOnlyItemToolName` then backstops the read-verb requirement; it is a third check, but
    // not a third boundary, since it reads the same tool name.
    let resultText: string;
    let errored: boolean;
    try {
      const args = buildReadToolArgs(await resolveInputSchema(tool), ref.values);
      const output = await (execute as ToolExecute)(args, {
        toolCallId: `reconcile-${randomUUID()}`,
        messages: [],
      });
      resultText = readOutputText(output);
      errored = (output as { isError?: boolean })?.isError === true;
    } catch (error) {
      return { ok: false, reason: classifyReadFailure(errorText(error)), detail: errorText(error) };
    }

    if (errored) {
      return {
        ok: false,
        reason: classifyReadFailure(resultText),
        detail: resultText.slice(0, 500),
      };
    }

    const title = extractItemTitle(resultText);
    if (!title) {
      // The read succeeded but we could not find a title in it — retryable, because the next
      // attempt may hit a server version whose response we do understand.
      return { ok: false, reason: "transient", detail: "No title field in the read response" };
    }

    return { ok: true, platform: ref.platform, title };
  }
}

async function resolveInputSchema(tool: unknown): Promise<JsonSchemaLike> {
  const fallback: JsonSchemaLike = { properties: {} };
  if (!tool || typeof tool !== "object" || !("inputSchema" in tool)) {
    return fallback;
  }
  const raw = (tool as { inputSchema?: unknown }).inputSchema;
  if (raw === undefined || raw === null) {
    return fallback;
  }
  try {
    const json = await asSchema(raw as never).jsonSchema;
    return (json as JsonSchemaLike) ?? fallback;
  } catch {
    return typeof raw === "object" ? (raw as JsonSchemaLike) : fallback;
  }
}

/** Mirrors how the orchestrator flattens an MCP tool result into text. */
function readOutputText(output: unknown): string {
  const content = (output as { content?: unknown })?.content;
  if (!Array.isArray(content)) {
    return typeof output === "string" ? output : JSON.stringify(output ?? "");
  }
  return content
    .map((item: { text?: string; type?: string; resource?: { text?: string } }) => {
      if (item.text) return item.text;
      if (item.type === "resource" && item.resource?.text) return item.resource.text;
      return "";
    })
    .filter(Boolean)
    .join("\n\n");
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
