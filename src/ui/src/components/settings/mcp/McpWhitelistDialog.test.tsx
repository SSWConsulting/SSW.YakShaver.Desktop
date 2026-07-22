import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ipcClient } from "../../../services/ipc-client";
import { McpWhitelistDialog } from "./McpWhitelistDialog";

vi.mock("../../../services/ipc-client", () => ({
  ipcClient: {
    mcp: {
      listServerTools: vi.fn().mockResolvedValue([]),
      updateServerAsync: vi.fn().mockResolvedValue({ success: true }),
    },
  },
}));

const server = {
  id: "srv-1",
  name: "Acme",
  transport: "streamableHttp" as const,
  url: "https://example.com/mcp",
  enabled: true,
  toolWhitelist: [],
};

describe("McpWhitelistDialog", () => {
  beforeEach(() => vi.clearAllMocks());

  it("titles the popup 'MCP Tools'", async () => {
    render(<McpWhitelistDialog server={server} onClose={() => {}} onSaved={() => {}} />);
    expect(await screen.findByText("MCP Tools")).toBeInTheDocument();
  });

  it("renders a load error inline instead of toasting", async () => {
    (ipcClient.mcp.listServerTools as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("boom"),
    );
    render(<McpWhitelistDialog server={server} onClose={() => {}} onSaved={() => {}} />);
    expect(await screen.findByText(/Failed to load tools/i)).toBeInTheDocument();
  });

  it("ignores a stale request that resolves after switching servers (#982)", async () => {
    // First server's request never resolves until we release it, by which point
    // the dialog has switched to the second server.
    let releaseFirst: (tools: { name: string }[]) => void = () => {};
    const first = new Promise<{ name: string }[]>((resolve) => {
      releaseFirst = resolve;
    });
    const listServerTools = ipcClient.mcp.listServerTools as ReturnType<typeof vi.fn>;
    listServerTools.mockReturnValueOnce(first).mockResolvedValueOnce([{ name: "toolbeta" }]);

    const serverB = { ...server, id: "srv-2", name: "Beta" };
    const { rerender } = render(
      <McpWhitelistDialog server={server} onClose={() => {}} onSaved={() => {}} />,
    );
    // Switch to server B before the first request resolves.
    rerender(<McpWhitelistDialog server={serverB} onClose={() => {}} onSaved={() => {}} />);
    expect(await screen.findByText(/toolbeta/i)).toBeInTheDocument();

    // The stale first response arrives late — it must not overwrite server B's tools.
    releaseFirst([{ name: "toolalpha" }]);
    await Promise.resolve();
    expect(screen.queryByText(/toolalpha/i)).not.toBeInTheDocument();
    expect(screen.getByText(/toolbeta/i)).toBeInTheDocument();
  });
});
