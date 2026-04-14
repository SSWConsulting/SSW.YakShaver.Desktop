import { EventEmitter } from "node:events";
import https from "node:https";
import { shell } from "electron";
import type {
  ClientMetadata,
  Configuration,
  TokenEndpointResponse,
  TokenEndpointResponseHelpers,
  UserInfoResponse,
} from "openid-client";
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

const AUTH_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const TOKEN_EXPIRY_BUFFER_MS = 60 * 1000; // refresh 60s before expiry

type OpenIdClientModule = typeof import("openid-client");
type TokenResponse = TokenEndpointResponse & TokenEndpointResponseHelpers;

interface PendingAuth {
  codeVerifier: string;
  state: string;
  resolve: (result: AuthResult) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class IdentityServerAuthService extends EventEmitter {
  private static instance: IdentityServerAuthService | null = null;
  private openIdClientPromise: Promise<OpenIdClientModule> | null = null;
  private clientConfiguration: Configuration | null = null;
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

  private getIdentityServerConfig() {
    return config.identityServer();
  }

  private getScopes(): string {
    return this.getIdentityServerConfig().scopes.join(" ");
  }

  private getRedirectUri(): string {
    const identityServerConfig = this.getIdentityServerConfig();
    const protocol =
      identityServerConfig.customProtocol ||
      (config.isDev() ? "yakshaver-desktop-dev" : "yakshaver-desktop");
    return `${protocol}://identity-server/callback`;
  }

  private async getOpenIdClient(): Promise<OpenIdClientModule> {
    if (!this.openIdClientPromise) {
      const importOpenIdClient = new Function(
        "specifier",
        'return import(specifier);',
      ) as (specifier: string) => Promise<OpenIdClientModule>;

      this.openIdClientPromise = importOpenIdClient("openid-client");
    }

    return this.openIdClientPromise;
  }

  private async getClientConfiguration(): Promise<Configuration> {
    if (this.clientConfiguration) {
      return this.clientConfiguration;
    }

    const openIdClient = await this.getOpenIdClient();

    const { url, clientId } = this.getIdentityServerConfig();

    if (!url || !clientId) {
      throw new Error("IdentityServer URL or Client ID is not configured.");
    }

    const issuerUrl = new URL(url);

    if (issuerUrl.protocol !== "https:") {
      throw new Error("IdentityServer URL must use HTTPS.");
    }

    const clientMetadata: Partial<ClientMetadata> = {
      redirect_uris: [this.getRedirectUri()],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    };

    const configuration = await openIdClient.discovery(
      issuerUrl,
      clientId,
      clientMetadata,
      openIdClient.None(),
    );

    this.clientConfiguration = configuration;

    return configuration;
  }

  private getScopeList(scope: string | undefined): string[] {
    return (scope ?? this.getScopes()).split(" ").filter(Boolean);
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
      const openIdClient = await this.getOpenIdClient();
      const clientConfiguration = await this.getClientConfiguration();
      const accessToken = this.currentTokens?.accessToken;

      if (!accessToken) {
        return undefined;
      }

      const userinfo = (await openIdClient.fetchUserInfo(
        clientConfiguration,
        accessToken,
        openIdClient.skipSubjectCheck,
      )) as UserInfoResponse;

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
      const openIdClient = await this.getOpenIdClient();
      const clientConfiguration = await this.getClientConfiguration();

      const codeVerifier = openIdClient.randomPKCECodeVerifier();
      const codeChallenge = await openIdClient.calculatePKCECodeChallenge(codeVerifier);
      const state = openIdClient.randomState();

      const authorizationParameters = {
        redirect_uri: this.getRedirectUri(),
        scope: this.getScopes(),
        code_challenge: codeChallenge,
        code_challenge_method: "S256",
        state,
      };

      const authUrl = openIdClient.buildAuthorizationUrl(
        clientConfiguration,
        authorizationParameters,
      );

      await shell.openExternal(authUrl.href);

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
      const openIdClient = await this.getOpenIdClient();
      const clientConfiguration = await this.getClientConfiguration();

      const redirectUri = this.getRedirectUri();
      console.log("[IdentityServerAuth] Expected redirect URI:", redirectUri);
      console.log("[IdentityServerAuth] Expected callback URI:", callbackUrl);

      const tokenSet = await openIdClient.authorizationCodeGrant(
        clientConfiguration,
        new URL(callbackUrl),
        {
          idTokenExpected: true,
          pkceCodeVerifier: codeVerifier,
          expectedState: state,
        },
        {
          redirect_uri: redirectUri,
        },
      );

      console.log("[IdentityServerAuth] Received token set:", tokenSet);

      await this.storeTokenSet(tokenSet);

      if (!tokenSet.access_token) {
        throw new Error("IdentityServer did not return an access token.");
      }

      await this.registerTenantAfterLogin(tokenSet.access_token);

      const userInfo = await this.getUserInfo();

      resolve({ success: true, userInfo });
    } catch (error) {
      const message = formatAndReportError(error, "identity_server_callback");
      resolve({ success: false, error: message });
    }
  }

  private async storeTokenSet(tokenSet: TokenResponse): Promise<void> {
    const expiresIn = tokenSet.expiresIn() ?? tokenSet.expires_in ?? 3600;

    const tokenData: TokenData = {
      accessToken: tokenSet.access_token ?? "",
      refreshToken: tokenSet.refresh_token ?? "",
      expiresAt: Date.now() + expiresIn * 1000,
      scope: this.getScopeList(tokenSet.scope),
    };

    this.currentTokens = tokenData;
    await this.storage.storeTokens(tokenData);
  }

  private async tryRefreshTokens(): Promise<boolean> {
    if (!this.currentTokens?.refreshToken) return false;

    try {
      const openIdClient = await this.getOpenIdClient();
      const clientConfiguration = await this.getClientConfiguration();
      const tokenSet = await openIdClient.refreshTokenGrant(
        clientConfiguration,
        this.currentTokens.refreshToken,
      );
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

  // After successful login, call the tenants/auth/callback endpoint to register the tenant if needed
  private async registerTenantAfterLogin(accessToken: string): Promise<void> {
    const apiUrl = config.portalApiUrl();
    const url = new URL(apiUrl);
    const hostname = url.hostname;
    const port = url.port ? Number.parseInt(url.port, 10) : url.protocol === "https:" ? 443 : 80;
    const path = `${url.pathname.replace(/\/$/, "")}/tenants/auth/callback`;

    await new Promise<void>((resolve, reject) => {
      const req = https.request(
        {
          hostname,
          port,
          path,
          method: "GET",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          rejectUnauthorized: !apiUrl.includes("localhost"),
        },
        (res) => {
          res.resume();

          res.on("end", () => {
            if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
              resolve();
              return;
            }

            reject(
              new Error(
                `Tenant registration failed: ${res.statusCode ?? "N/A"} ${res.statusMessage ?? "Unknown error"}`,
              ),
            );
          });
        },
      );

      req.on("error", (error) => {
        reject(error);
      });

      req.end();
    });
  }
}
