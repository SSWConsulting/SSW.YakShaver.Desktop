import { PRESET_SERVER_IDS } from "@shared/mcp/preset-servers";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HomeMcpStatusBanner } from "./HomeMcpStatusBanner";
import { MCP_HEALTH_REFRESH_EVENT } from "./mcp-status";

// vi.hoisted so the mock factory (hoisted above the imports) can reference these.
const { listServers, checkServerHealthAsync } = vi.hoisted(() => ({
  listServers: vi.fn(),
  checkServerHealthAsync: vi.fn(),
}));

vi.mock("@/services/ipc-client", () => ({
  ipcClient: { mcp: { listServers, checkServerHealthAsync } },
}));

const GITHUB = { id: PRESET_SERVER_IDS.GITHUB, name: "GitHub", builtin: false, enabled: true };
const ADO = {
  id: PRESET_SERVER_IDS.AZURE_DEVOPS,
  name: "Azure DevOps",
  builtin: false,
  enabled: true,
};
const health = (isHealthy: boolean) => ({ isHealthy, isChecking: false });

describe("HomeMcpStatusBanner (#869)", () => {
  beforeEach(() => {
    listServers.mockReset();
    checkServerHealthAsync.mockReset();
  });
  afterEach(() => vi.restoreAllMocks());

  it("warns + names a disconnected backlog provider, and the CTA opens MCP Settings (AC1/AC2)", async () => {
    listServers.mockResolvedValue([GITHUB, ADO]);
    checkServerHealthAsync.mockImplementation((id: string) =>
      Promise.resolve(health(id !== GITHUB.id)),
    );
    const dispatchSpy = vi.spyOn(window, "dispatchEvent");

    render(<HomeMcpStatusBanner />);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/GitHub.*disconnected/i);
    // the healthy provider must NOT be named
    expect(alert).not.toHaveTextContent(/Azure DevOps/i);

    await userEvent.click(screen.getByRole("button", { name: /open mcp settings/i }));

    const openEvent = dispatchSpy.mock.calls
      .map((call) => call[0])
      .find((e): e is CustomEvent => e instanceof CustomEvent && e.type === "open-settings-tab");
    expect(openEvent).toBeDefined();
    expect(openEvent?.detail).toEqual({ tabId: "mcp" });
  });

  it("renders nothing when every provider is healthy (AC3)", async () => {
    listServers.mockResolvedValue([GITHUB, ADO]);
    checkServerHealthAsync.mockResolvedValue(health(true));

    const { container } = render(<HomeMcpStatusBanner />);

    await waitFor(() => expect(checkServerHealthAsync).toHaveBeenCalled());
    expect(screen.queryByRole("alert")).toBeNull();
    expect(container).toBeEmptyDOMElement();
  });

  it("re-checks and shows the warning on MCP_HEALTH_REFRESH_EVENT (AC4)", async () => {
    listServers.mockResolvedValue([GITHUB]);
    let healthy = true;
    checkServerHealthAsync.mockImplementation(() => Promise.resolve(health(healthy)));

    render(<HomeMcpStatusBanner />);
    await waitFor(() => expect(checkServerHealthAsync).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("alert")).toBeNull();

    // reconnect state flips to unhealthy; closing Settings dispatches the refresh event
    healthy = false;
    await act(async () => {
      window.dispatchEvent(new Event(MCP_HEALTH_REFRESH_EVENT));
    });

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/GitHub.*disconnected/i);
  });
});
