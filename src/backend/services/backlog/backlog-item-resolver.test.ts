import type { ToolSet } from "ai";
import { describe, expect, it, vi } from "vitest";
import { GITHUB_PRESET_CONFIG, JIRA_PRESET_CONFIG } from "../../../shared/mcp/preset-servers";
import {
  buildReadToolArgs,
  classifyReadFailure,
  extractItemTitle,
  identifyServerPlatform,
  isReadOnlyItemToolName,
  McpBacklogItemResolver,
  mapServerPrefixesToPlatforms,
  parseBacklogItemUrl,
  selectReadToolName,
} from "./backlog-item-resolver";

describe("parseBacklogItemUrl", () => {
  it("reads a GitHub issue URL", () => {
    expect(parseBacklogItemUrl("https://github.com/SSWConsulting/YakShaver/issues/42")).toEqual({
      platform: "github",
      values: { owner: "SSWConsulting", repo: "YakShaver", number: "42" },
    });
  });

  it("reads an Azure DevOps work item URL", () => {
    expect(parseBacklogItemUrl("https://dev.azure.com/ssw/YakShaver/_workitems/edit/1234")).toEqual(
      {
        platform: "azure-devops",
        values: { organization: "ssw", project: "YakShaver", id: "1234" },
      },
    );
  });

  it("reads the legacy Azure DevOps host, where the org lives in the hostname", () => {
    expect(
      parseBacklogItemUrl("https://ssw.visualstudio.com/YakShaver/_workitems/edit/1234"),
    ).toEqual({
      platform: "azure-devops",
      values: { organization: "ssw", project: "YakShaver", id: "1234" },
    });
  });

  it.each([
    ["https://dev.azure.com/ssw/_workitems/edit/1234", "ssw"],
    ["https://ssw.visualstudio.com/_workitems/edit/1234", "ssw"],
  ])("keeps an org-level link readable without inventing a project (%s)", (url, organization) => {
    // The project segment is genuinely absent. Naming the org in its place would send the reader
    // looking in a project that does not exist, which reads worse than leaving it out.
    expect(parseBacklogItemUrl(url)).toEqual({
      platform: "azure-devops",
      values: { organization, id: "1234" },
    });
  });

  it("reads a Jira browse URL", () => {
    expect(parseBacklogItemUrl("https://ssw.atlassian.net/browse/YAK-7")).toEqual({
      platform: "jira",
      values: { key: "YAK-7" },
    });
  });

  it("rejects a pull request, which is not a backlog item", () => {
    expect(parseBacklogItemUrl("https://github.com/o/r/pull/9")).toBeUndefined();
  });

  it("rejects a self-hosted host we cannot classify", () => {
    expect(parseBacklogItemUrl("https://github.acme.internal/o/r/issues/9")).toBeUndefined();
  });
});

describe("identifyServerPlatform", () => {
  it("places a preset server by id even after the user renames it", () => {
    expect(
      identifyServerPlatform({
        ...GITHUB_PRESET_CONFIG,
        name: "MyRepo", // nothing in the name says GitHub any more
      }),
    ).toBe("github");
  });

  it("places a custom HTTP server by its endpoint host", () => {
    expect(
      identifyServerPlatform({
        id: "custom-1",
        name: "Tickets",
        transport: "streamableHttp",
        url: "https://mcp.atlassian.com/v1/mcp",
      }),
    ).toBe("jira");
  });

  it("places a custom stdio server by the package it launches", () => {
    expect(
      identifyServerPlatform({
        id: "custom-2",
        name: "Work",
        transport: "stdio",
        command: "npx",
        args: ["-y", "@azure-devops/mcp", "ssw2"],
      }),
    ).toBe("azure-devops");
  });

  it("falls back to the name when nothing else identifies the server", () => {
    expect(
      identifyServerPlatform({
        id: "custom-3",
        name: "GitHub Enterprise",
        transport: "stdio",
        command: "./my-server",
      }),
    ).toBe("github");
  });

  it("returns undefined for a server it cannot place", () => {
    expect(
      identifyServerPlatform({
        id: "custom-4",
        name: "Context7",
        transport: "streamableHttp",
        url: "https://mcp.context7.com/mcp",
      }),
    ).toBeUndefined();
  });
});

describe("selectReadToolName", () => {
  const toolSet = (...names: string[]) =>
    Object.fromEntries(names.map((name) => [name, {}])) as unknown as ToolSet;

  it("picks the platform's read tool", () => {
    expect(selectReadToolName(toolSet("GitHub__create_issue", "GitHub__get_issue"), "github")).toBe(
      "GitHub__get_issue",
    );
  });

  it("never reads a Jira issue to answer a GitHub URL", () => {
    // Both servers spell the tool `get_issue`; only the server tells them apart.
    expect(selectReadToolName(toolSet("Jira__get_issue"), "github")).toBeUndefined();
  });

  it("skips comment/search tools that carry the same nouns", () => {
    expect(
      selectReadToolName(toolSet("GitHub__get_issue_comments", "GitHub__search_issues"), "github"),
    ).toBeUndefined();
  });

  it("finds the Azure DevOps work item reader", () => {
    expect(selectReadToolName(toolSet("Azure_DevOps__wit_get_work_item"), "azure-devops")).toBe(
      "Azure_DevOps__wit_get_work_item",
    );
  });

  it("still finds the reader on a server whose NAME says nothing about the platform", () => {
    // The whole point of the config lookup: "MyRepo__get_issue" is unmatchable by name alone.
    const serverPlatforms = mapServerPrefixesToPlatforms([
      { ...GITHUB_PRESET_CONFIG, name: "MyRepo" },
    ]);

    expect(selectReadToolName(toolSet("MyRepo__get_issue"), "github", serverPlatforms)).toBe(
      "MyRepo__get_issue",
    );
  });

  it("does not answer a GitHub URL with a renamed Jira server's identically named tool", () => {
    const serverPlatforms = mapServerPrefixesToPlatforms([
      { ...JIRA_PRESET_CONFIG, name: "MyRepo" },
    ]);

    expect(
      selectReadToolName(toolSet("MyRepo__get_issue"), "github", serverPlatforms),
    ).toBeUndefined();
  });

  it("reproduces the whitespace-to-underscore prefix the toolset actually uses", () => {
    const serverPlatforms = mapServerPrefixesToPlatforms([
      { ...GITHUB_PRESET_CONFIG, name: "My Repo" },
    ]);

    expect(selectReadToolName(toolSet("My_Repo__get_issue"), "github", serverPlatforms)).toBe(
      "My_Repo__get_issue",
    );
  });
});

describe("isReadOnlyItemToolName", () => {
  // The names real servers actually expose. A write verb added to MUTATION_VERB that also appears
  // in one of these would silently disable reconciliation for that platform, so they are asserted
  // rather than assumed — an over-eager denylist fails here instead of in telemetry.
  it.each([
    "GitHub__get_issue",
    "GitHub__issue_read",
    "Azure_DevOps__wit_get_work_item",
    "Jira__jira_get_issue",
    "Jira__getJiraIssue",
    "get_issue",
  ])("admits the real reader %s", (name) => {
    expect(isReadOnlyItemToolName(name)).toBe(true);
  });

  // Names that pass selectReadToolName's read-verb requirement and still carry a write verb —
  // the only shape this backstop exists for.
  it.each([
    "GitHub__update_issue_details",
    "GitHub__get_or_update_issue",
    "GitHub__issue_read_write",
    "GitHub__delete_issue_view",
  ])("refuses %s, which reads AND writes", (name) => {
    expect(isReadOnlyItemToolName(name)).toBe(false);
  });

  it("judges the operation, not the server it came from", () => {
    // A server named "Issue Updates" must not condemn its own read tool.
    expect(isReadOnlyItemToolName("Issue_Updates__get_issue")).toBe(true);
  });
});

describe("buildReadToolArgs", () => {
  it("fills the parameter names the tool actually declares", () => {
    const schema = {
      properties: {
        owner: { type: "string" },
        repo: { type: "string" },
        issue_number: { type: "number" },
        unrelated: { type: "string" },
      },
    };

    expect(buildReadToolArgs(schema, { owner: "o", repo: "r", number: "42" })).toEqual({
      owner: "o",
      repo: "r",
      issue_number: 42,
    });
  });

  it("answers an action-based tool's operation parameter with its read verb", () => {
    const schema = {
      properties: {
        method: { type: "string", enum: ["get", "create", "update"] },
        issueNumber: { type: "number" },
      },
    };

    expect(buildReadToolArgs(schema, { number: "7" })).toEqual({ method: "get", issueNumber: 7 });
  });
});

describe("extractItemTitle", () => {
  it("reads a bare GitHub issue payload", () => {
    expect(extractItemTitle('{"number":42,"title":"🐛 Login button does nothing"}')).toBe(
      "🐛 Login button does nothing",
    );
  });

  it("reads an Azure DevOps fields payload", () => {
    expect(extractItemTitle('{"id":1,"fields":{"System.Title":"Fix the importer"}}')).toBe(
      "Fix the importer",
    );
  });

  it("reads a Jira summary payload", () => {
    expect(extractItemTitle('{"key":"YAK-7","fields":{"summary":"Ship the resolver"}}')).toBe(
      "Ship the resolver",
    );
  });

  it("returns undefined for a response with no title", () => {
    expect(extractItemTitle('{"ok":true}')).toBeUndefined();
  });
});

describe("classifyReadFailure", () => {
  it.each([
    ["401 Unauthorized", "unauthenticated"],
    ["Work item is in the Removed state (deleted)", "deleted"],
    ["404 Not Found", "not_found"],
    ["socket hang up", "transient"],
  ])("classifies %s", (message, expected) => {
    expect(classifyReadFailure(message)).toBe(expected);
  });
});

describe("McpBacklogItemResolver", () => {
  const githubTool = (result: unknown) => ({
    inputSchema: {
      type: "object",
      properties: {
        owner: { type: "string" },
        repo: { type: "string" },
        issue_number: { type: "number" },
      },
    },
    execute: vi.fn().mockResolvedValue(result),
  });

  const makeResolver = (tools: Record<string, unknown>, configs = [GITHUB_PRESET_CONFIG]) =>
    new McpBacklogItemResolver({
      collectToolsForSelectedServersAsync: vi.fn().mockResolvedValue(tools),
      listAvailableServers: vi.fn().mockResolvedValue(configs),
    });

  it("returns the work item's CURRENT title, not the one YakShaver proposed", async () => {
    const tool = githubTool({
      content: [{ type: "text", text: '{"title":"🐛 Existing duplicate title"}' }],
    });
    const resolver = makeResolver({ GitHub__get_issue: tool });

    const result = await resolver.resolveAsync("https://github.com/o/r/issues/42");

    expect(result).toEqual({ ok: true, platform: "github", title: "🐛 Existing duplicate title" });
    expect(tool.execute).toHaveBeenCalledWith(
      { owner: "o", repo: "r", issue_number: 42 },
      expect.objectContaining({ toolCallId: expect.any(String) }),
    );
  });

  it("reports a deleted item as non-retryable rather than throwing", async () => {
    const tool = githubTool({
      isError: true,
      content: [{ type: "text", text: "404 Not Found" }],
    });
    const resolver = makeResolver({ GitHub__get_issue: tool });

    await expect(resolver.resolveAsync("https://github.com/o/r/issues/42")).resolves.toMatchObject({
      ok: false,
      reason: "not_found",
    });
  });

  it("reports no_read_tool when the project's servers expose no reader", async () => {
    const resolver = makeResolver({ GitHub__create_issue: {} });

    await expect(resolver.resolveAsync("https://github.com/o/r/issues/42")).resolves.toMatchObject({
      ok: false,
      reason: "no_read_tool",
    });
  });

  it("refuses to execute a tool that reads AND writes, distinctly from having no reader", async () => {
    // `get_or_update_issue` satisfies the read-verb match and still authors the item. The refusal
    // carries its own reason so a backstop that fires is never mistaken for a missing tool.
    const tool = githubTool({ content: [{ type: "text", text: '{"title":"whatever"}' }] });
    const resolver = makeResolver({ GitHub__get_or_update_issue: tool });

    await expect(resolver.resolveAsync("https://github.com/o/r/issues/42")).resolves.toMatchObject({
      ok: false,
      reason: "refused_mutation_tool",
    });
    expect(tool.execute).not.toHaveBeenCalled();
  });

  it("treats an unreachable server as transient, not as a bad URL", async () => {
    const resolver = new McpBacklogItemResolver({
      collectToolsForSelectedServersAsync: vi
        .fn()
        .mockRejectedValue(new Error("no healthy servers")),
      listAvailableServers: vi.fn().mockResolvedValue([]),
    });

    await expect(resolver.resolveAsync("https://github.com/o/r/issues/42")).resolves.toMatchObject({
      ok: false,
      reason: "transient",
    });
  });

  it("restricts the read to the project's selected servers", async () => {
    const collect = vi.fn().mockResolvedValue({});
    const resolver = new McpBacklogItemResolver({
      collectToolsForSelectedServersAsync: collect,
      listAvailableServers: vi.fn().mockResolvedValue([]),
    });

    await resolver.resolveAsync("https://github.com/o/r/issues/42", ["github"]);

    expect(collect).toHaveBeenCalledWith(["github"]);
  });

  it("still resolves when the server list is unavailable (tool-name fallback)", async () => {
    const tool = githubTool({ content: [{ type: "text", text: '{"title":"Still works"}' }] });
    const resolver = new McpBacklogItemResolver({
      collectToolsForSelectedServersAsync: vi.fn().mockResolvedValue({ GitHub__get_issue: tool }),
      listAvailableServers: vi.fn().mockRejectedValue(new Error("storage unavailable")),
    });

    await expect(resolver.resolveAsync("https://github.com/o/r/issues/42")).resolves.toMatchObject({
      ok: true,
      title: "Still works",
    });
  });

  it("reads through a renamed GitHub server end to end", async () => {
    const tool = githubTool({ content: [{ type: "text", text: '{"title":"Renamed server"}' }] });
    const resolver = makeResolver({ MyRepo__get_issue: tool }, [
      { ...GITHUB_PRESET_CONFIG, name: "MyRepo" },
    ]);

    await expect(resolver.resolveAsync("https://github.com/o/r/issues/42")).resolves.toMatchObject({
      ok: true,
      title: "Renamed server",
    });
  });
});
