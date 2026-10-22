import { GITHUB_PRESET_CONFIG, PRESET_SERVER_IDS } from "@shared/mcp/preset-servers";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MCPServerConfig } from "../McpServerForm";
import { McpGitHubCard } from "./mcp-github-card";

const ipc = vi.hoisted(() => ({
  updateServerAsync: vi.fn(),
  clearTokensAsync: vi.fn(),
  reauthorizeAsync: vi.fn(),
}));

vi.mock("@/services/ipc-client", () => ({ ipcClient: { mcp: ipc } }));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

const PAT_CONFIG = {
  ...GITHUB_PRESET_CONFIG,
  headers: { Authorization: "Bearer github_pat_123" },
  enabled: true,
} satisfies MCPServerConfig;

describe("McpGitHubCard personal access token (#1062)", () => {
  beforeEach(() => {
    ipc.updateServerAsync.mockReset().mockResolvedValue(undefined);
    ipc.clearTokensAsync.mockReset().mockResolvedValue(undefined);
  });

  it("connects with a personal access token instead of the OAuth sign-in", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<McpGitHubCard viewMode="detailed" onChange={onChange} />);

    await user.click(screen.getByRole("button", { name: /use a personal access token/i }));
    await user.type(screen.getByLabelText("Personal access token"), "  github_pat_123  ");
    await user.click(screen.getByRole("button", { name: "Connect with token" }));

    const expected = expect.objectContaining({
      headers: { Authorization: "Bearer github_pat_123" },
      enabled: true,
    });
    await waitFor(() =>
      expect(ipc.updateServerAsync).toHaveBeenCalledWith(PRESET_SERVER_IDS.GITHUB, expected),
    );
    expect(onChange).toHaveBeenCalledWith(expected);
    expect(screen.queryByLabelText("Personal access token")).toBeNull();
  });

  it("does not submit an empty token", async () => {
    const user = userEvent.setup();
    render(<McpGitHubCard viewMode="detailed" />);

    await user.click(screen.getByRole("button", { name: /use a personal access token/i }));

    expect(screen.getByRole("button", { name: "Connect with token" })).toBeDisabled();
  });

  it("forgets the token on disconnect", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<McpGitHubCard viewMode="detailed" config={PAT_CONFIG} onChange={onChange} />);

    expect(screen.getByText("Using a personal access token.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /disconnect/i }));

    const expected = expect.objectContaining({ headers: undefined, enabled: false });
    await waitFor(() =>
      expect(ipc.updateServerAsync).toHaveBeenCalledWith(PRESET_SERVER_IDS.GITHUB, expected),
    );
    expect(ipc.clearTokensAsync).toHaveBeenCalledWith(PRESET_SERVER_IDS.GITHUB);
  });

  it("offers Disconnect, not the OAuth Reauthorize, when a token is rejected", () => {
    render(
      <McpGitHubCard
        viewMode="detailed"
        config={PAT_CONFIG}
        healthInfo={{ isHealthy: false, isChecking: false, authFailed: true }}
      />,
    );

    expect(screen.queryByRole("button", { name: /reauthorize/i })).toBeNull();
    expect(screen.getByRole("button", { name: /disconnect/i })).toBeInTheDocument();
  });
});
