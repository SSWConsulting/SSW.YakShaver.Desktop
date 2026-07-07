import { PRESET_SERVER_IDS } from "@shared/mcp/preset-servers";
import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StatusDashboard } from "./StatusDashboard";
import { STATUS_DASHBOARD_REFRESH_EVENT } from "./status-dashboard";

// vi.hoisted so the mock factory (hoisted above the imports) can reference these.
const { status, listServers, checkServerHealthAsync, getConfig, checkOrchestratorReadiness } =
  vi.hoisted(() => ({
    status: vi.fn(),
    listServers: vi.fn(),
    checkServerHealthAsync: vi.fn(),
    getConfig: vi.fn(),
    checkOrchestratorReadiness: vi.fn(),
  }));

vi.mock("@/services/ipc-client", () => ({
  ipcClient: {
    auth: { identityServer: { status } },
    mcp: { listServers, checkServerHealthAsync },
    llm: { getConfig, checkOrchestratorReadiness },
  },
}));

const GITHUB = { id: PRESET_SERVER_IDS.GITHUB, name: "GitHub", builtin: false, enabled: true };
const healthyLlm = {
  languageModel: { provider: "openai", model: "gpt-5.2", apiKey: "test-api-key" },
};

describe("StatusDashboard (#948)", () => {
  beforeEach(() => {
    status.mockReset();
    listServers.mockReset();
    checkServerHealthAsync.mockReset();
    getConfig.mockReset();
    checkOrchestratorReadiness.mockReset();
  });
  afterEach(() => vi.restoreAllMocks());

  it("shows a yellow login warning, red MCP and red language-model rows with the exact warning copy when nothing is configured", async () => {
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

  it("shows a red language-model row when the local-claude backend is configured but not ready", async () => {
    status.mockResolvedValue({ status: "authenticated" });
    listServers.mockResolvedValue([]);
    getConfig.mockResolvedValue({
      languageModel: { provider: "openai", model: "gpt-5.2", apiKey: "test-api-key" },
      orchestrationBackend: "local-claude",
    });
    checkOrchestratorReadiness.mockResolvedValue({
      installed: false,
      authenticated: false,
      ready: false,
      state: "not-installed",
      message: "Claude Code CLI not found.",
    });

    render(<StatusDashboard />);

    await waitFor(() => expect(checkOrchestratorReadiness).toHaveBeenCalled());
    expect(screen.getByText(/claude code cli not found/i)).toBeTruthy();
  });

  it("address review #949: exposes the status row container as an aria-live region", async () => {
    status.mockResolvedValue({ status: "authenticated" });
    listServers.mockResolvedValue([]);
    getConfig.mockResolvedValue(healthyLlm);

    render(<StatusDashboard />);

    await waitFor(() => expect(listServers).toHaveBeenCalled());

    const region = screen.getByRole("status");
    expect(region).toHaveAttribute("aria-live", "polite");
  });
});
