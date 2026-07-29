import type { OAuthTokens } from "@ai-sdk/mcp";
import { afterEach, describe, expect, it, vi } from "vitest";
import { McpOAuthTokenStorage, type StoredOAuthTokens } from "./mcp-oauth-token-storage";

vi.mock("electron", () => ({
  app: { getPath: () => "C:\\temp" },
}));

const FIRST_TOKENS: OAuthTokens = {
  access_token: "first-access",
  refresh_token: "first-refresh",
  token_type: "bearer",
};

const LATE_TOKENS: OAuthTokens = {
  access_token: "late-access",
  refresh_token: "late-refresh",
  token_type: "bearer",
};

describe("McpOAuthTokenStorage.completeOAuthAsync (#771)", () => {
  const storage = McpOAuthTokenStorage.getInstance();

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("stores only the first result when polling and deep link complete together", async () => {
    let storedTokens: StoredOAuthTokens | undefined;
    vi.spyOn(storage, "getTokensAsync").mockImplementation(async () => storedTokens);
    const saveTokens = vi
      .spyOn(storage, "saveTokensAsync")
      .mockImplementation(async (_serverId, tokens) => {
        storedTokens = { ...tokens, storedAt: Date.now() };
      });

    const completions = await Promise.all([
      storage.completeOAuthAsync("server-1", FIRST_TOKENS),
      storage.completeOAuthAsync("server-1", LATE_TOKENS),
    ]);

    expect(completions).toEqual([true, false]);
    expect(saveTokens).toHaveBeenCalledOnce();
    expect(storedTokens?.access_token).toBe(FIRST_TOKENS.access_token);
  });
});
