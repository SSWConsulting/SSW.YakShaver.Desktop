import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { IS_AUTH_CHANGED_EVENT, LLM_CONFIG_CHANGED_EVENT } from "../../types";

const { getConfig, status } = vi.hoisted(() => ({
  getConfig: vi.fn(),
  status: vi.fn(),
}));
vi.mock("@/services/ipc-client", () => ({
  ipcClient: {
    llm: { getConfig },
    auth: { identityServer: { status } },
  },
}));

import { useCloud360Mode } from "./useCloud360Mode";

beforeEach(() => {
  getConfig.mockReset();
  status.mockReset();
  status.mockResolvedValue({ status: "authenticated" });
});

describe("useCloud360Mode", () => {
  it("is360Mode true only for cloud-360 backend", async () => {
    getConfig.mockResolvedValue({ orchestrationBackend: "cloud-360" });
    const { result } = renderHook(() => useCloud360Mode());
    await waitFor(() => expect(result.current.is360Mode).toBe(true));
  });

  it("is360Mode false for openai backend", async () => {
    getConfig.mockResolvedValue({ orchestrationBackend: "openai" });
    const { result } = renderHook(() => useCloud360Mode());
    await waitFor(() => expect(result.current.is360Mode).toBe(false));
  });

  // The orchestrator backend is changed in the Settings dialog, which does not
  // remount the recording page. The hook must re-read config when config changes
  // (e.g. via the LLM_CONFIG_CHANGED_EVENT the settings save dispatches), otherwise
  // is360Mode stays stale until an app restart.
  it("re-reads config on LLM_CONFIG_CHANGED_EVENT so a settings change takes effect without remount", async () => {
    getConfig.mockResolvedValue({ orchestrationBackend: "openai" });
    const { result } = renderHook(() => useCloud360Mode());
    await waitFor(() => expect(result.current.is360Mode).toBe(false));

    getConfig.mockResolvedValue({ orchestrationBackend: "cloud-360" });
    act(() => {
      window.dispatchEvent(new CustomEvent(LLM_CONFIG_CHANGED_EVENT));
    });

    await waitFor(() => expect(result.current.is360Mode).toBe(true));
  });

  // Sign-in happens in the sidebar, which does not remount the recording page.
  // The hook must re-read auth status on IS_AUTH_CHANGED_EVENT, otherwise a user
  // who signs in after opening the recording page stays gated (Record disabled).
  it("re-reads sign-in on IS_AUTH_CHANGED_EVENT so signing in enables recording without remount", async () => {
    getConfig.mockResolvedValue({ orchestrationBackend: "cloud-360" });
    status.mockReset();
    status.mockResolvedValue({ status: "unauthenticated" });
    const { result } = renderHook(() => useCloud360Mode());
    await waitFor(() => expect(result.current.isSignedIn).toBe(false));

    status.mockResolvedValue({ status: "authenticated" });
    act(() => {
      window.dispatchEvent(new CustomEvent(IS_AUTH_CHANGED_EVENT));
    });

    await waitFor(() => expect(result.current.isSignedIn).toBe(true));
  });
});
