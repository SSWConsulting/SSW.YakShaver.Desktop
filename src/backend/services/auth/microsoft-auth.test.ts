import type { AccountInfo, AuthenticationResult } from "@azure/msal-node";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MicrosoftAuthService } from "./microsoft-auth";
import { type AuthState, AuthStatus } from "./types";

// 1. Setup hoisted mocks
const mocks = vi.hoisted(() => {
  const mockTokenCache = {
    getAllAccounts: vi.fn(),
    removeAccount: vi.fn(),
    serialize: vi.fn(),
    deserialize: vi.fn(),
  };

  const mockPCA = {
    acquireTokenSilent: vi.fn(),
    acquireTokenInteractive: vi.fn(),
    getTokenCache: vi.fn(() => mockTokenCache),
  };

  return {
    mockPCA,
    mockTokenCache,
  };
});

// 2. Mock @azure/msal-node
vi.mock("@azure/msal-node", () => {
  return {
    PublicClientApplication: class {
      constructor() {
        return mocks.mockPCA;
      }
    },
    LogLevel: { Info: 0 },
    InteractionRequiredAuthError: class extends Error {},
  };
});

// 3. Mock electron
vi.mock("electron", () => ({
  app: {
    isPackaged: false,
    getPath: vi.fn().mockReturnValue("/tmp/userData"),
  },
  shell: {
    openExternal: vi.fn(),
  },
  safeStorage: {
    isEncryptionAvailable: vi.fn().mockReturnValue(true),
    encryptString: vi.fn().mockImplementation((str) => Buffer.from(str)),
    decryptString: vi.fn().mockImplementation((buf) => buf.toString()),
  },
}));

// 4. Mock config
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

// 5. Mock fs/promises and path
vi.mock("node:fs", () => {
  return {
    existsSync: vi.fn().mockReturnValue(true),
    readFileSync: vi.fn().mockReturnValue("<html>YOUR_APP_PROTOCOL</html>"),
    promises: {
      access: vi.fn().mockResolvedValue(undefined),
      mkdir: vi.fn().mockResolvedValue(undefined),
      writeFile: vi.fn().mockResolvedValue(undefined),
      readFile: vi.fn().mockResolvedValue(Buffer.from(JSON.stringify({}))),
      unlink: vi.fn().mockResolvedValue(undefined),
    },
  };
});

vi.mock("node:path", () => ({
  join: (...args: string[]) => args.join("/"),
}));

describe("MicrosoftAuthService", () => {
  let service: MicrosoftAuthService;

  const mockAccount: AccountInfo = {
    homeAccountId: "home-id",
    environment: "env",
    tenantId: "tenant-id",
    username: "test@example.com",
    localAccountId: "local-id",
    name: "Test User",
  };

  beforeEach(() => {
    vi.clearAllMocks();

    // Reset the getTokenCache behavior since it's a function on the object
    mocks.mockPCA.getTokenCache.mockReturnValue(mocks.mockTokenCache);

    // @ts-ignore - Accessing private static property for testing
    MicrosoftAuthService.account = null;

    service = MicrosoftAuthService.getInstance({
      clientId: "mock-client-id",
      tenantId: "mock-tenant-id",
      scopes: ["mock-scope"],
      customProtocol: "mock-protocol",
    });
  });

  describe("getAuthState", () => {
    it("should return NOT_AUTHENTICATED when no account exists", async () => {
      mocks.mockTokenCache.getAllAccounts.mockResolvedValue([]);
      const state = await service.getAuthState();
      expect(state.status).toBe(AuthStatus.NOT_AUTHENTICATED);
    });

    it("should return AUTHENTICATED when account exists and token acquisition succeeds", async () => {
      mocks.mockTokenCache.getAllAccounts.mockResolvedValue([mockAccount]);
      mocks.mockPCA.acquireTokenSilent.mockResolvedValue({
        account: mockAccount,
        accessToken: "token",
      } as AuthenticationResult);

      const state = await service.getAuthState();
      expect(state.status).toBe(AuthStatus.AUTHENTICATED);
      if (state.status === AuthStatus.AUTHENTICATED) {
        expect(
          (state as AuthState & { accountInfo: AccountInfo }).accountInfo
        ).toBe(mockAccount);
      }
    });

    it("should return NOT_AUTHENTICATED when token acquisition fails", async () => {
      // 1. Setup: Account exists in cache
      mocks.mockTokenCache.getAllAccounts.mockResolvedValue([mockAccount]);

      const { InteractionRequiredAuthError } = await import("@azure/msal-node");

      // 2. Mock Silent Failure
      mocks.mockPCA.acquireTokenSilent.mockRejectedValue(
        new InteractionRequiredAuthError("Interaction required")
      );

      // 3. Mock Interactive Failure
      mocks.mockPCA.acquireTokenInteractive.mockRejectedValue(
        new InteractionRequiredAuthError("Interaction required")
      );

      const state = await service.getAuthState();
      expect(state.status).toBe(AuthStatus.NOT_AUTHENTICATED);
    });
  });

  describe("login", () => {
    it("should return account info on successful login", async () => {
      mocks.mockTokenCache.getAllAccounts.mockResolvedValue([]);
      mocks.mockPCA.acquireTokenInteractive.mockResolvedValue({
        account: mockAccount,
        accessToken: "token",
      } as AuthenticationResult);

      const result = await service.login();
      expect(result).toEqual(mockAccount);
      expect(service.currentAccount()).toEqual(mockAccount);
    });

    it("should return null on login failure", async () => {
      mocks.mockTokenCache.getAllAccounts.mockResolvedValue([]);
      mocks.mockPCA.acquireTokenInteractive.mockRejectedValue(
        new Error("Login failed")
      );

      const result = await service.login();
      expect(result).toBeNull();
    });
  });

  describe("getToken", () => {
    it("should use default scopes if not provided", async () => {
      mocks.mockTokenCache.getAllAccounts.mockResolvedValue([mockAccount]);
      mocks.mockPCA.acquireTokenSilent.mockResolvedValue({
        account: mockAccount,
        accessToken: "token",
      } as AuthenticationResult);

      await service.getToken();

      expect(mocks.mockPCA.acquireTokenSilent).toHaveBeenCalledWith(
        expect.objectContaining({
          scopes: ["mock-scope"],
          account: mockAccount,
        })
      );
    });
  });

  describe("logout", () => {
    it("should remove account from cache", async () => {
      // Setup internal account state
      mocks.mockTokenCache.getAllAccounts.mockResolvedValue([mockAccount]);
      mocks.mockPCA.acquireTokenSilent.mockResolvedValue({
        account: mockAccount,
        accessToken: "token",
      } as AuthenticationResult);

      // Initial auth to set the account
      await service.getAuthState();

      await service.logout();
      expect(mocks.mockTokenCache.removeAccount).toHaveBeenCalledWith(
        mockAccount
      );
      expect(service.currentAccount()).toBeNull();
    });
  });
});
