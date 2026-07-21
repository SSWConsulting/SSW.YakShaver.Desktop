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
});
