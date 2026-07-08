import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReleaseChannel } from "./types";

const toastMock = {
  error: vi.fn(),
  info: vi.fn(),
  success: vi.fn(),
};

vi.mock("sonner", () => ({
  toast: toastMock,
}));

const releaseChannelMock = {
  get: vi.fn<() => Promise<ReleaseChannel>>(),
  set: vi.fn<(channel: ReleaseChannel) => Promise<void>>(),
  listReleases: vi.fn<
    () => Promise<{
      releases: Array<{
        prNumber: string;
        tag: string;
        version: string;
        publishedAt: string;
      }>;
      error?: string;
    }>
  >(),
  checkUpdates: vi.fn<
    () => Promise<{
      available: boolean;
      error?: string;
      version?: string;
    }>
  >(),
  getCurrentVersion: vi.fn<() => Promise<{ version: string }>>(),
};

const githubTokenMock = {
  get: vi.fn<() => Promise<string | undefined>>(),
  set: vi.fn<(token: string) => Promise<void>>(),
  clear: vi.fn<() => Promise<void>>(),
  has: vi.fn<() => Promise<boolean>>(),
  verify: vi.fn<
    () => Promise<{
      isValid: boolean;
      username?: string;
      scopes?: string[];
      rateLimitRemaining?: number;
      error?: string;
    }>
  >(),
};

async function renderSetting() {
  const { ReleaseChannelSetting } = await import("./ReleaseChannelSetting");
  return render(<ReleaseChannelSetting isActive={true} />);
}

describe("ReleaseChannelSetting", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();

    releaseChannelMock.get.mockResolvedValue({ type: "latest" });
    releaseChannelMock.set.mockResolvedValue(undefined);
    releaseChannelMock.listReleases.mockResolvedValue({
      releases: [
        {
          prNumber: "943",
          tag: "v1.2.0-beta.943",
          version: "1.2.0-beta.943",
          publishedAt: "2026-07-01T10:00:00.000Z",
        },
      ],
    });
    releaseChannelMock.checkUpdates.mockResolvedValue({
      available: true,
      version: "1.2.0",
    });
    releaseChannelMock.getCurrentVersion.mockResolvedValue({ version: "1.1.0" });

    githubTokenMock.get.mockResolvedValue("ghp_test-token");
    githubTokenMock.set.mockResolvedValue(undefined);
    githubTokenMock.clear.mockResolvedValue(undefined);
    githubTokenMock.has.mockResolvedValue(true);
    githubTokenMock.verify.mockResolvedValue({
      isValid: true,
      username: "test-user",
      scopes: ["repo"],
      rateLimitRemaining: 1000,
    });

    Object.defineProperty(window, "electronAPI", {
      value: {
        releaseChannel: releaseChannelMock,
        githubToken: githubTokenMock,
      } as unknown as Window["electronAPI"],
      configurable: true,
    });
  });

  it("loads the current version and enables update checks when a GitHub token exists", async () => {
    await renderSetting();

    expect(await screen.findByText("1.1.0")).toBeInTheDocument();

    const checkButton = screen.getByRole("button", { name: "Check for Updates" });
    await waitFor(() => expect(checkButton).toBeEnabled());
    expect(screen.queryByText("GitHub Token Required")).not.toBeInTheDocument();
  });

  it("checks for updates using the selected release channel", async () => {
    const user = userEvent.setup();
    await renderSetting();

    const checkButton = screen.getByRole("button", { name: "Check for Updates" });
    await waitFor(() => expect(checkButton).toBeEnabled());
    await user.click(checkButton);

    await waitFor(() => {
      expect(releaseChannelMock.set).toHaveBeenCalledWith({ type: "latest" });
      expect(releaseChannelMock.checkUpdates).toHaveBeenCalledTimes(1);
    });
    expect(await screen.findByText(/Update found: 1\.2\.0/)).toBeInTheDocument();
    expect(toastMock.success).toHaveBeenCalledWith(
      "Update available. Version 1.2.0 will download automatically.",
    );
  });

  it("keeps update checks disabled and explains the token requirement when no token exists", async () => {
    githubTokenMock.has.mockResolvedValue(false);

    await renderSetting();

    expect(await screen.findByText("GitHub Token Required")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Check for Updates" })).toBeDisabled();
  });
});
