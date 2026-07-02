import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
});

describe("useCloud360Mode", () => {
  it("is360Mode true only for cloud-360 backend", async () => {
    getConfig.mockResolvedValue({ orchestrationBackend: "cloud-360" });
    status.mockResolvedValue({ status: "authenticated" });
    const { result } = renderHook(() => useCloud360Mode());
    await waitFor(() => expect(result.current.is360Mode).toBe(true));
  });

  it("is360Mode false for openai backend", async () => {
    getConfig.mockResolvedValue({ orchestrationBackend: "openai" });
    status.mockResolvedValue({ status: "authenticated" });
    const { result } = renderHook(() => useCloud360Mode());
    await waitFor(() => expect(result.current.is360Mode).toBe(false));
  });
});
