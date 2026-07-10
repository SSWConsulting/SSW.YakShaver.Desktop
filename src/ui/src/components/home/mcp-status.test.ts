import { PRESET_SERVER_IDS } from "@shared/mcp/preset-servers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { selectDisconnectedProviders } from "./mcp-status";

// vi.hoisted so the mock factory (hoisted above the import) can reference these.
const { listServers, checkServerHealthAsync } = vi.hoisted(() => ({
  listServers: vi.fn(),
  checkServerHealthAsync: vi.fn(),
}));

vi.mock("@/services/ipc-client", () => ({
  ipcClient: { mcp: { listServers, checkServerHealthAsync } },
}));

type Server = { id: string; name: string; builtin?: boolean; enabled?: boolean };

const GITHUB = PRESET_SERVER_IDS.GITHUB;
const ADO = PRESET_SERVER_IDS.AZURE_DEVOPS;
const JIRA = PRESET_SERVER_IDS.JIRA;

const servers: Server[] = [
  { id: GITHUB, name: "GitHub" },
  { id: ADO, name: "Azure DevOps" },
  { id: JIRA, name: "Jira", enabled: false }, // disabled -> not a provider
  { id: "yak_video_tools", name: "Yak_Video_Tools", builtin: true }, // builtin -> not a provider
  { id: "custom-docs-mcp", name: "My Docs MCP" }, // custom, non-backlog -> not a provider
];

describe("selectDisconnectedProviders (#869)", () => {
  it("reports a known backlog provider whose health is explicitly unhealthy", () => {
    const result = selectDisconnectedProviders(servers, {
      [GITHUB]: { isHealthy: false },
      [ADO]: { isHealthy: true },
    });
    expect(result).toEqual([{ id: GITHUB, name: "GitHub" }]);
  });

  it("returns none when all providers are healthy", () => {
    const result = selectDisconnectedProviders(servers, {
      [GITHUB]: { isHealthy: true },
      [ADO]: { isHealthy: true },
    });
    expect(result).toEqual([]);
  });

  it("ignores builtin and disabled servers even when unhealthy", () => {
    const result = selectDisconnectedProviders(servers, {
      [GITHUB]: { isHealthy: true },
      [ADO]: { isHealthy: true },
      [JIRA]: { isHealthy: false },
      yak_video_tools: { isHealthy: false },
    });
    expect(result).toEqual([]);
  });

  it("does NOT flag an unrelated custom (non-backlog) MCP server, even when unhealthy", () => {
    // a custom docs/search server going down must not claim "backlog items can't be created"
    const result = selectDisconnectedProviders(servers, {
      "custom-docs-mcp": { isHealthy: false },
    });
    expect(result).toEqual([]);
  });

  it("does NOT report a provider whose health is still unknown (no false warning while loading)", () => {
    const result = selectDisconnectedProviders(servers, { [ADO]: { isHealthy: true } });
    // github has no health entry yet -> not reported
    expect(result).toEqual([]);
  });

  it("reports multiple disconnected backlog providers", () => {
    const result = selectDisconnectedProviders(servers, {
      [GITHUB]: { isHealthy: false },
      [ADO]: { isHealthy: false },
    });
    expect(result.map((p) => p.name)).toEqual(["GitHub", "Azure DevOps"]);
  });
});

describe("fetchBacklogProviderHealth (address review #949: hung-server timeout)", () => {
  beforeEach(() => {
    listServers.mockReset();
    checkServerHealthAsync.mockReset();
    vi.resetModules();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("resolves a wedged (never-settling) health probe to isHealthy:false instead of hanging forever", async () => {
    vi.useFakeTimers();
    const { fetchBacklogProviderHealth } = await import("./mcp-status");

    listServers.mockResolvedValue([{ id: GITHUB, name: "GitHub", enabled: true }]);
    checkServerHealthAsync.mockImplementation(() => new Promise(() => {})); // never resolves

    const resultPromise = fetchBacklogProviderHealth();
    await vi.advanceTimersByTimeAsync(8000);
    const result = await resultPromise;

    expect(result.healthById[GITHUB]).toEqual({ isHealthy: false, isChecking: false });
  });
});
