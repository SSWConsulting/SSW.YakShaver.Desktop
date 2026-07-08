import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReleaseChannelSetting } from "./ReleaseChannelSetting";

// vi.hoisted so the mock factory (hoisted above the imports) can reference these.
const { get, set, listReleases, checkUpdates, getCurrentVersion, onDownloadProgress, hasToken } =
  vi.hoisted(() => ({
    get: vi.fn(),
    set: vi.fn(),
    listReleases: vi.fn(),
    checkUpdates: vi.fn(),
    getCurrentVersion: vi.fn(),
    onDownloadProgress: vi.fn(),
    hasToken: vi.fn(),
  }));

vi.mock("@/services/ipc-client", () => ({
  ipcClient: {
    releaseChannel: {
      get,
      set,
      listReleases,
      checkUpdates,
      getCurrentVersion,
      onDownloadProgress,
    },
    githubToken: { has: hasToken },
  },
}));

describe("ReleaseChannelSetting (#423)", () => {
  beforeEach(() => {
    get.mockReset().mockResolvedValue({ type: "latest" });
    set.mockReset().mockResolvedValue(undefined);
    listReleases.mockReset().mockResolvedValue({ releases: [] });
    checkUpdates.mockReset();
    getCurrentVersion.mockReset().mockResolvedValue({ version: "1.2.3", commitHash: "abc123" });
    onDownloadProgress.mockReset().mockReturnValue(() => {});
    hasToken.mockReset().mockResolvedValue(true);
  });
  afterEach(() => vi.restoreAllMocks());

  it("shows the current installed version (AC1)", async () => {
    render(<ReleaseChannelSetting isActive={true} />);

    expect(await screen.findByText("1.2.3")).toBeInTheDocument();
    expect(screen.getByText("Current Version")).toBeInTheDocument();
  });

  it("shows the new available version and labels a major bump (AC2/AC3)", async () => {
    checkUpdates.mockResolvedValue({
      available: true,
      version: "2.0.0",
      currentVersion: "1.2.3",
    });

    render(<ReleaseChannelSetting isActive={true} />);
    await screen.findByText("1.2.3");

    await userEvent.click(screen.getByRole("button", { name: /check for updates/i }));

    const versionCard = await screen.findByText("New Version Available");
    await waitFor(() => {
      expect(versionCard.parentElement).toHaveTextContent("2.0.0");
      expect(versionCard.parentElement).toHaveTextContent(/Major update/i);
    });
    expect(screen.getAllByText(/Major update/i).length).toBeGreaterThan(0);
  });

  it("labels a minor bump distinctly from a major bump (AC3)", async () => {
    checkUpdates.mockResolvedValue({
      available: true,
      version: "1.3.0",
      currentVersion: "1.2.3",
    });

    render(<ReleaseChannelSetting isActive={true} />);
    await screen.findByText("1.2.3");

    await userEvent.click(screen.getByRole("button", { name: /check for updates/i }));

    const versionCard = await screen.findByText("New Version Available");
    await waitFor(() => {
      expect(versionCard.parentElement).toHaveTextContent(/Minor update/i);
    });
  });

  it("labels a patch bump distinctly from major/minor bumps (AC3)", async () => {
    checkUpdates.mockResolvedValue({
      available: true,
      version: "1.2.4",
      currentVersion: "1.2.3",
    });

    render(<ReleaseChannelSetting isActive={true} />);
    await screen.findByText("1.2.3");

    await userEvent.click(screen.getByRole("button", { name: /check for updates/i }));

    const versionCard = await screen.findByText("New Version Available");
    await waitFor(() => {
      expect(versionCard.parentElement).toHaveTextContent(/Patch update/i);
    });
  });

  it("does not show a 'New Version Available' card when no update is available", async () => {
    checkUpdates.mockResolvedValue({ available: false, currentVersion: "1.2.3" });

    render(<ReleaseChannelSetting isActive={true} />);
    await screen.findByText("1.2.3");

    await userEvent.click(screen.getByRole("button", { name: /check for updates/i }));

    await waitFor(() => {
      expect(screen.getByText(/latest version/i)).toBeInTheDocument();
    });
    expect(screen.queryByText("New Version Available")).not.toBeInTheDocument();
  });

  it("labels a pre-release-only bump distinctly, matching the PR/beta channel's own version scheme (AC3)", async () => {
    getCurrentVersion.mockResolvedValue({
      version: "0.6.0-beta.940.1700000000000",
      commitHash: "abc123",
    });
    checkUpdates.mockResolvedValue({
      available: true,
      version: "0.6.0-beta.941.1700000001000",
      currentVersion: "0.6.0-beta.940.1700000000000",
    });

    render(<ReleaseChannelSetting isActive={true} />);
    await screen.findByText("0.6.0-beta.940.1700000000000");

    await userEvent.click(screen.getByRole("button", { name: /check for updates/i }));

    const versionCard = await screen.findByText("New Version Available");
    await waitFor(() => {
      expect(versionCard.parentElement).toHaveTextContent(/Pre-release update/i);
    });
  });

  it("keeps the version card's bump label consistent with the toast when the update check resolves before loadCurrentVersion", async () => {
    // loadCurrentVersion() never resolves (simulates it not having finished yet), so
    // `currentVersion` state starts empty; the version card's label must still match
    // the toast/status label, both driven by the authoritative `result.currentVersion`.
    getCurrentVersion.mockReturnValue(new Promise(() => {}));
    checkUpdates.mockResolvedValue({
      available: true,
      version: "2.0.0",
      currentVersion: "1.2.3",
    });

    render(<ReleaseChannelSetting isActive={true} />);

    await userEvent.click(screen.getByRole("button", { name: /check for updates/i }));

    const versionCard = await screen.findByText("New Version Available");
    await waitFor(() => {
      expect(versionCard.parentElement).toHaveTextContent(/Major update/i);
    });
    // Toast/status label agrees with the version card.
    expect(screen.getAllByText(/Major update/i).length).toBeGreaterThan(0);
  });
});
