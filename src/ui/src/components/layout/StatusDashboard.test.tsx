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

// The video-host row reads the same YouTube auth context the Record button gates on;
// mocked here so tests can drive it without standing up YouTubeAuthProvider (which
// would pull in its own IPC + workflow-event subscriptions).
const { useYouTubeAuth } = vi.hoisted(() => ({ useYouTubeAuth: vi.fn() }));
vi.mock("@/contexts/YouTubeAuthContext", () => ({ useYouTubeAuth }));

function mockVideoHost(status: string, isLoading = false) {
  useYouTubeAuth.mockReturnValue({ authState: { status }, isLoading });
}

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
    useYouTubeAuth.mockReset();
    mockVideoHost("authenticated");
  });
  afterEach(() => vi.restoreAllMocks());

  it("shows a yellow login warning, red video-host, MCP and language-model rows with the exact warning copy when nothing is configured", async () => {
    status.mockResolvedValue({ status: "not_authenticated" });
    listServers.mockResolvedValue([]);
    getConfig.mockResolvedValue(null);
    mockVideoHost("not_authenticated");

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
    expect(
      screen.getByText("You don't have any video host connected, so you can't start recording"),
    ).toBeTruthy();
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
    expect(screen.queryByText(/can't start recording/i)).toBeNull();
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

  it("re-derives the video-host row from context alone, with no extra IPC round-trip", async () => {
    status.mockResolvedValue({ status: "authenticated" });
    listServers.mockResolvedValue([]);
    getConfig.mockResolvedValue(healthyLlm);
    mockVideoHost("not_authenticated");

    const { rerender } = render(<StatusDashboard />);
    await waitFor(() => expect(screen.getByText(/you can't start recording/i)).toBeTruthy());
    const ipcCallsSoFar = listServers.mock.calls.length;

    // Connecting YouTube in Settings updates the context; the row must follow immediately
    // rather than waiting for the next focus/refresh re-check.
    mockVideoHost("authenticated");
    rerender(<StatusDashboard />);

    await waitFor(() => expect(screen.queryByText(/you can't start recording/i)).toBeNull());
    expect(listServers).toHaveBeenCalledTimes(ipcCallsSoFar);
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
