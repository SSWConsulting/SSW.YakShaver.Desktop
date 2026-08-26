import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthStatus } from "../types";
import { useYouTubeAuth, YouTubeAuthProvider } from "./YouTubeAuthContext";

// #1023 review round 3 — regression for the blocking finding: a focus-triggered
// re-check of YouTube auth status was re-entering the shared `isLoading` state on
// every window focus, not just the initial mount. ScreenRecorder's disabled-reason
// tooltip/Badge/banner suppress themselves while `isLoading` is true (see
// isAuthInfoLoading), so this flipped isLoading true->false on every focus and
// recreated the exact #1022 "disabled button, no explanation" symptom
// intermittently. This suite proves isLoading only toggles for the very first
// check and stays settled through later focus-triggered re-checks.

const getAuthStatus = vi.fn();

vi.mock("../services/ipc-client", () => ({
  ipcClient: {
    youtube: {
      getAuthStatus: (...args: unknown[]) => getAuthStatus(...args),
    },
    workflow: {
      onProgressNeo: vi.fn(() => () => {}),
    },
  },
}));

function Probe() {
  const { authState, isLoading } = useYouTubeAuth();
  return (
    <div>
      <span data-testid="is-loading">{String(isLoading)}</span>
      <span data-testid="auth-status">{authState.status}</span>
    </div>
  );
}

beforeEach(() => {
  (window as unknown as { electronAPI: unknown }).electronAPI = {};
  getAuthStatus.mockReset();
  getAuthStatus.mockResolvedValue({
    status: AuthStatus.AUTHENTICATED,
    userInfo: { name: "Tester" },
  });
});

afterEach(() => {
  delete (window as unknown as { electronAPI?: unknown }).electronAPI;
});

describe("YouTubeAuthProvider isLoading (#1023 review round 3)", () => {
  it("does not re-enter isLoading on a focus-triggered re-check after the initial check settles", async () => {
    render(
      <YouTubeAuthProvider>
        <Probe />
      </YouTubeAuthProvider>,
    );

    // Initial check: isLoading starts true and settles to false once resolved.
    await waitFor(() => {
      expect(screen.getByTestId("is-loading").textContent).toBe("false");
    });
    expect(screen.getByTestId("auth-status").textContent).toBe(AuthStatus.AUTHENTICATED);
    expect(getAuthStatus).toHaveBeenCalledTimes(1);

    // A focus-triggered re-check must refresh authState without ever observably
    // flipping isLoading back to true — that flash is what recreates #1022. Assert
    // immediately after dispatch (before the refetch promise resolves): on the
    // pre-fix code, `setIsLoading(true)` ran synchronously before the first
    // `await`, so this check would already read "true" here.
    getAuthStatus.mockResolvedValueOnce({ status: AuthStatus.NOT_AUTHENTICATED });
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(screen.getByTestId("is-loading").textContent).toBe("false");

    await waitFor(() => {
      expect(getAuthStatus).toHaveBeenCalledTimes(2);
    });
    await waitFor(() => {
      expect(screen.getByTestId("auth-status").textContent).toBe(AuthStatus.NOT_AUTHENTICATED);
    });
    expect(screen.getByTestId("is-loading").textContent).toBe("false");
  });
});
