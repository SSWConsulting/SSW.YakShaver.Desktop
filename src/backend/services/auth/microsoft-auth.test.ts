import type { AccountInfo, AuthenticationResult } from "@azure/msal-node";
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { MicrosoftAuthService } from "./microsoft-auth";
import { type AuthState, AuthStatus } from "./types";

// Mock dependencies
vi.mock("electron", () => ({
  app: {
    isPackaged: false,
  },
  shell: {
    openExternal: vi.fn(),
  },
}));

vi.mock("../../config/env", () => ({
  config: {
    azure: vi.fn().mockReturnValue({
      clientId: "mock-client-id",
      tenantId: "mock-tenant-id",
      scopes: ["mock-scope"],
      customProtocol: "mock-protocol",
    }),
  },
}));

vi.mock("node:fs", () => ({
  existsSync: vi.fn().mockReturnValue(true),
  readFileSync: vi.fn().mockReturnValue("<html>YOUR_APP_PROTOCOL</html>"),
}));

vi.mock("node:path", () => ({
  join: (...args: string[]) => args.join("/"),
}));

describe("MicrosoftAuthService", () => {
  let service: MicrosoftAuthService;
  let mockPCA: {
    acquireTokenSilent: Mock;
    acquireTokenInteractive: Mock;
    getTokenCache: Mock;
  };
  let mockTokenCache: {
    getAllAccounts: Mock;
    removeAccount: Mock;
  };

  const mockAccount: AccountInfo = {
    homeAccountId: "home-id",
    environment: "env",
    tenantId: "tenant-id",
    username: "test@example.com",
    localAccountId: "local-id",
    name: "Test User",
  };

  beforeEach(() => {
    mockTokenCache = {
      getAllAccounts: vi.fn(),
      removeAccount: vi.fn(),
    };

    mockPCA = {
      acquireTokenSilent: vi.fn(),
      acquireTokenInteractive: vi.fn(),
      getTokenCache: vi.fn().mockReturnValue(mockTokenCache),
    };

    service = MicrosoftAuthService.getInstance({
      clientId: "mock-client-id",
      tenantId: "mock-tenant-id",
      scopes: ["mock-scope"],
      customProtocol: "mock-protocol",
    });
  });

  describe("getAuthState", () => {
    it("should return NOT_AUTHENTICATED when no account exists", async () => {
      mockTokenCache.getAllAccounts.mockResolvedValue([]);
      const state = await service.getAuthState();
      expect(state.status).toBe(AuthStatus.NOT_AUTHENTICATED);
    });

    it("should return AUTHENTICATED when account exists and token acquisition succeeds", async () => {
      mockTokenCache.getAllAccounts.mockResolvedValue([mockAccount]);
      mockPCA.acquireTokenSilent.mockResolvedValue({
        account: mockAccount,
        accessToken: "token",
      } as AuthenticationResult);

      const state = await service.getAuthState();
      expect(state.status).toBe(AuthStatus.AUTHENTICATED);
      if (state.status === AuthStatus.AUTHENTICATED) {
        expect((state as AuthState & { accountInfo: AccountInfo }).accountInfo).toBe(mockAccount);
      }
    });

    it("should return NOT_AUTHENTICATED when token acquisition fails", async () => {
      mockTokenCache.getAllAccounts.mockResolvedValue([mockAccount]);
      mockPCA.acquireTokenSilent.mockRejectedValue(new Error("Silent failed"));
      mockPCA.acquireTokenInteractive.mockRejectedValue(new Error("Interactive failed"));

      const state = await service.getAuthState();
      expect(state.status).toBe(AuthStatus.ERROR);
    });
  });

  describe("login", () => {
    it("should return account info on successful login", async () => {
      mockTokenCache.getAllAccounts.mockResolvedValue([]);
      mockPCA.acquireTokenInteractive.mockResolvedValue({
        account: mockAccount,
        accessToken: "token",
      } as AuthenticationResult);

      const result = await service.login();
      expect(result).toEqual(mockAccount);
      expect(service.currentAccount()).toEqual(mockAccount);
    });

    it("should return null on login failure", async () => {
      mockTokenCache.getAllAccounts.mockResolvedValue([]);
      mockPCA.acquireTokenInteractive.mockRejectedValue(new Error("Login failed"));

      const result = await service.login();
      expect(result).toBeNull();
    });
  });

  describe("getToken", () => {
    it("should use default scopes if not provided", async () => {
      mockTokenCache.getAllAccounts.mockResolvedValue([mockAccount]);
      mockPCA.acquireTokenSilent.mockResolvedValue({
        account: mockAccount,
        accessToken: "token",
      } as AuthenticationResult);

      await service.getToken();

      expect(mockPCA.acquireTokenSilent).toHaveBeenCalledWith(
        expect.objectContaining({
          scopes: ["mock-scope"],
          account: mockAccount,
        }),
      );
    });
  });

  describe("logout", () => {
    it("should remove account from cache", async () => {
      // Setup internal account state
      mockTokenCache.getAllAccounts.mockResolvedValue([mockAccount]);
      mockPCA.acquireTokenSilent.mockResolvedValue({
        account: mockAccount,
        accessToken: "token",
      } as AuthenticationResult);

      // Initial auth to set the account
      await service.getAuthState();

      await service.logout();
      expect(mockTokenCache.removeAccount).toHaveBeenCalledWith(mockAccount);
      expect(service.currentAccount()).toBeNull();
    });
  });
});
