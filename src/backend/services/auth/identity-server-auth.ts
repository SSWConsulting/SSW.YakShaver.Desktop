import { EventEmitter } from "node:events";
import { shell } from "electron";
import { type Client, generators, Issuer, type TokenSet } from "openid-client";
import { config } from "../../config/env";
import { formatAndReportError } from "../../utils/error-utils";
import { IdentityServerTokenStorage } from "../storage/identity-server-token-storage";
import {
  type AuthResult,
  type AuthState,
  AuthStatus,
  type TokenData,
  type UserInfo,
} from "./types";

const CLIENT_ID = "ssw-yakshaver-desktop-client";
const SCOPES = "openid profile email ssw-yakshaver-api offline_access";
const AUTH_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const TOKEN_EXPIRY_BUFFER_MS = 60 * 1000; // refresh 60s before expiry

interface PendingAuth {
  codeVerifier: string;
  state: string;
  resolve: (result: AuthResult) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class IdentityServerAuthService extends EventEmitter {
  private static instance: IdentityServerAuthService | null = null;
  private client: Client | null = null;
  private pendingAuth: PendingAuth | null = null;
  private storage = IdentityServerTokenStorage.getInstance();
  private currentTokens: TokenData | null = null;

  private constructor() {
    super();
  }

  static getInstance(): IdentityServerAuthService {
    if (!IdentityServerAuthService.instance) {
      IdentityServerAuthService.instance = new IdentityServerAuthService();
    }
    return IdentityServerAuthService.instance;
  }

  private getRedirectUri(): string {
    const protocol = config.isDev() ? "yakshaver-desktop-dev" : "yakshaver-desktop";
    return `${protocol}://identity-server/callback`;
  }

  private async getClient(): Promise<Client> {
    if (this.client) {
      return this.client;
    }

    const { url } = config.identityServer();
    const issuer = await Issuer.discover(url);

    this.client = new issuer.Client({
      client_id: CLIENT_ID,
      redirect_uris: [this.getRedirectUri()],
      response_types: ["code"],
      token_endpoint_auth_method: "none", // PKCE - no client secret
    });

    return this.client;
  }

  async initialize(): Promise<void> {
    try {
      // Load cached tokens on startup
      this.currentTokens = await this.storage.getTokens();
    } catch (error) {
      console.warn("[IdentityServerAuth] Failed to load cached tokens:", error);
    }
  }

  async getAuthState(): Promise<AuthState> {
    if (!this.currentTokens) {
      return { status: AuthStatus.NOT_AUTHENTICATED };
    }

    // Check token expiry
    if (this.currentTokens.expiresAt <= Date.now() + TOKEN_EXPIRY_BUFFER_MS) {
      const refreshed = await this.tryRefreshTokens();
      if (!refreshed) {
        return { status: AuthStatus.NOT_AUTHENTICATED };
      }
    }

    return {
      status: AuthStatus.AUTHENTICATED,
      userInfo: await this.getUserInfo(),
    };
  }

  isAuthenticated(): boolean {
    if (!this.currentTokens) return false;
    return this.currentTokens.expiresAt > Date.now() + TOKEN_EXPIRY_BUFFER_MS;
  }

  getAccessToken(): string | null {
    if (!this.isAuthenticated()) return null;
    return this.currentTokens?.accessToken ?? null;
  }

  private async getUserInfo(): Promise<UserInfo | undefined> {
    try {
      const client = await this.getClient();
      const accessToken = this.currentTokens?.accessToken;
      if (!accessToken) return undefined;

      const userinfo = await client.userinfo(accessToken);
      return {
        id: String(userinfo.sub),
        name: String(userinfo.name ?? userinfo.preferred_username ?? userinfo.sub),
        email: String(userinfo.email ?? ""),
      };
    } catch (error) {
      console.warn("[IdentityServerAuth] Failed to get user info:", error);
      return undefined;
    }
  }

  async login(): Promise<AuthResult> {
    // Cancel any existing pending auth
    this.cancelPendingAuth();

    try {
      const client = await this.getClient();

      const codeVerifier = generators.codeVerifier();
      const codeChallenge = generators.codeChallenge(codeVerifier);
      const state = generators.state();

      const authUrl = client.authorizationUrl({
        scope: SCOPES,
        code_challenge: codeChallenge,
        code_challenge_method: "S256",
        state,
      });

      await shell.openExternal(authUrl);

      return new Promise<AuthResult>((resolve, reject) => {
        const timer = setTimeout(() => {
          if (this.pendingAuth) {
            this.pendingAuth = null;
            resolve({ success: false, error: "Authentication timed out" });
          }
        }, AUTH_TIMEOUT_MS);

        this.pendingAuth = { codeVerifier, state, resolve, reject, timer };
      });
    } catch (error) {
      const message = formatAndReportError(error, "identity_server_login");
      return { success: false, error: message };
    }
  }

  async handleCallback(callbackUrl: string): Promise<void> {
    if (!this.pendingAuth) {
      console.warn("[IdentityServerAuth] Received callback with no pending auth");
      return;
    }

    const { codeVerifier, state, resolve, timer } = this.pendingAuth;
    this.pendingAuth = null;
    clearTimeout(timer);

    try {
      const client = await this.getClient();

      const redirectUri = this.getRedirectUri();
      console.log("[IdentityServerAuth] Expected redirect URI:", redirectUri);
      console.log("[IdentityServerAuth] Expected callback URI:", callbackUrl);

      const params = client.callbackParams(callbackUrl);
      const tokenSet = await client.callback(redirectUri, params, {
        code_verifier: codeVerifier,
        state,
      });

      console.log("[IdentityServerAuth] Received token set:", tokenSet);

      await this.storeTokenSet(tokenSet);
      const userInfo = await this.getUserInfo();

      resolve({ success: true, userInfo });
    } catch (error) {
      const message = formatAndReportError(error, "identity_server_callback");
      resolve({ success: false, error: message });
    }
  }

  private async storeTokenSet(tokenSet: TokenSet): Promise<void> {
    const expiresIn = tokenSet.expires_in ?? 3600;
    const tokenData: TokenData = {
      accessToken: tokenSet.access_token ?? "",
      refreshToken: tokenSet.refresh_token ?? "",
      expiresAt: Date.now() + expiresIn * 1000,
      scope: (tokenSet.scope ?? SCOPES).split(" "),
    };

    this.currentTokens = tokenData;
    await this.storage.storeTokens(tokenData);
  }

  private async tryRefreshTokens(): Promise<boolean> {
    if (!this.currentTokens?.refreshToken) return false;

    try {
      const client = await this.getClient();
      const tokenSet = await client.refresh(this.currentTokens.refreshToken);
      await this.storeTokenSet(tokenSet);
      return true;
    } catch (error) {
      console.warn("[IdentityServerAuth] Token refresh failed:", error);
      this.currentTokens = null;
      await this.storage.clearTokens();
      return false;
    }
  }

  async logout(): Promise<boolean> {
    this.cancelPendingAuth();
    this.currentTokens = null;
    await this.storage.clearTokens();
    return true;
  }

  private cancelPendingAuth(): void {
    if (this.pendingAuth) {
      clearTimeout(this.pendingAuth.timer);
      this.pendingAuth.resolve({ success: false, error: "Authentication cancelled" });
      this.pendingAuth = null;
    }
  }
}
