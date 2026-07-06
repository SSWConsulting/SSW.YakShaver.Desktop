import { PRESET_SERVER_IDS } from "@shared/mcp/preset-servers";
import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StatusDashboard } from "./StatusDashboard";
import { STATUS_DASHBOARD_REFRESH_EVENT } from "./status-dashboard";

// vi.hoisted so the mock factory (hoisted above the imports) can reference these.
const { status, listServers, checkServerHealthAsync, getConfig } = vi.hoisted(() => ({
  status: vi.fn(),
  listServers: vi.fn(),
  checkServerHealthAsync: vi.fn(),
  getConfig: vi.fn(),
}));

vi.mock("@/services/ipc-client", () => ({
  ipcClient: {
    auth: { identityServer: { status } },
    mcp: { listServers, checkServerHealthAsync },
    llm: { getConfig },
  },
}));

const GITHUB = { id: PRESET_SERVER_IDS.GITHUB, name: "GitHub", builtin: false, enabled: true };
const healthyLlm = { languageModel: { provider: "openai", model: "gpt-5.2", apiKey: "sk-live" } };

describe("StatusDashboard (#948)", () => {
  beforeEach(() => {
    status.mockReset();
    listServers.mockReset();
    checkServerHealthAsync.mockReset();
    getConfig.mockReset();
  });
  afterEach(() => vi.restoreAllMocks());

  it("shows green login, red MCP and red language-model rows with the exact warning copy when nothing is configured", async () => {
    status.mockResolvedValue({ status: "not_authenticated" });
    listServers.mockResolvedValue([]);
    getConfig.mockResolvedValue(null);

    render(<StatusDashboard />);

    await waitFor(() => expect(listServers).toHaveBeenCalled());

    expect(
      screen.getByText(
        "You don't have any MCP server connected, so the shave or request might fail",
      ),
    ).toBeTruthy();
    expect(
      screen.getByText(
        "You don't have any language model connected, so probably the shave will fail",
      ),
    ).toBeTruthy();
    expect(screen.getByText(/not be synced with the portal/i)).toBeTruthy();
  });

  it("shows no warning text for a row once its config is healthy", async () => {
    status.mockResolvedValue({ status: "authenticated" });
    listServers.mockResolvedValue([GITHUB]);
    checkServerHealthAsync.mockResolvedValue({ isHealthy: true, isChecking: false });
    getConfig.mockResolvedValue(healthyLlm);

    render(<StatusDashboard />);

    await waitFor(() => expect(checkServerHealthAsync).toHaveBeenCalled());
    expect(screen.queryByText(/might fail/i)).toBeNull();
    expect(screen.queryByText(/probably the shave will fail/i)).toBeNull();
    expect(screen.queryByText(/not be synced with the portal/i)).toBeNull();
  });

  it("re-checks on STATUS_DASHBOARD_REFRESH_EVENT (e.g. after Settings closes)", async () => {
    status.mockResolvedValue({ status: "not_authenticated" });
    listServers.mockResolvedValue([]);
    getConfig.mockResolvedValue(null);

    render(<StatusDashboard />);
    await waitFor(() => expect(listServers).toHaveBeenCalledTimes(1));

    status.mockResolvedValue({ status: "authenticated" });
    await act(async () => {
      window.dispatchEvent(new Event(STATUS_DASHBOARD_REFRESH_EVENT));
    });

    await waitFor(() => expect(listServers).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByText(/not be synced with the portal/i)).toBeNull());
  });
});
