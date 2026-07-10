import { PRESET_SERVER_IDS } from "@shared/mcp/preset-servers";
import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSettingsTabHealth } from "./settings-health";

// vi.hoisted so the mock factory (hoisted above the import) can reference these.
const { getConfig, listServers, checkServerHealthAsync, checkOrchestratorReadiness, has } =
  vi.hoisted(() => ({
    getConfig: vi.fn(),
    listServers: vi.fn(),
    checkServerHealthAsync: vi.fn(),
    checkOrchestratorReadiness: vi.fn(),
    has: vi.fn(),
  }));

vi.mock("@/services/ipc-client", () => ({
  ipcClient: {
    llm: { getConfig, checkOrchestratorReadiness },
    mcp: { listServers, checkServerHealthAsync },
    githubToken: { has },
  },
}));

const GITHUB = { id: PRESET_SERVER_IDS.GITHUB, name: "GitHub", enabled: true };

/** Minimal harness — `useSettingsTabHealth` is a hook, so it needs a host component to render. */
function Harness({ open }: { open: boolean }) {
  const health = useSettingsTabHealth(open);
  return <div data-testid="health">{JSON.stringify(health)}</div>;
}

describe("useSettingsTabHealth (address review #949: wedged MCP server timeout)", () => {
  beforeEach(() => {
    getConfig.mockReset();
    listServers.mockReset();
    checkServerHealthAsync.mockReset();
    checkOrchestratorReadiness.mockReset();
    has.mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("resolves a wedged (never-settling) MCP health probe instead of hanging the check() forever", async () => {
    vi.useFakeTimers();
    getConfig.mockResolvedValue(null);
    listServers.mockResolvedValue([GITHUB]);
    has.mockResolvedValue(true);
    checkServerHealthAsync.mockImplementation(() => new Promise(() => {})); // never resolves

    const { getByTestId } = render(<Harness open={true} />);

    // Advance past the shared HEALTH_CHECK_TIMEOUT_MS bound (8s) so the wedged probe times out,
    // and let the resulting setHealth() flush.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(8000);
    });

    const health = JSON.parse(getByTestId("health").textContent ?? "{}");
    // No disconnected-backlog-provider critical state is raised — the timed-out probe resolves
    // to isHealthy:false via the shared helper, not left undefined/pending forever.
    expect(health.mcp?.severity).toBe("critical");
  }, 15000);
});
