// Followed example from Microsoft's Electron sample app
// https://github.com/AzureAD/microsoft-authentication-library-for-js/blob/dev/samples/msal-node-samples/ElectronSystemBrowserTestApp/README.md
import { join } from "node:path";
import { InteractionRequiredAuthError, LogLevel, PublicClientApplication } from "@azure/msal-node";
import { app, shell } from "electron";
import { formatErrorMessage } from "../../utils/error-utils";
import { MsalSecureCachePlugin } from "./msal-cache-plugin";
import type { AuthState } from "./types";
import { AuthStatus } from "./types";
import "isomorphic-fetch";
import * as fs from "node:fs";
import type {
  AccountInfo,
  AuthenticationResult,
  InteractiveRequest,
  SilentFlowRequest,
} from "@azure/msal-node";

export interface AzureConfig {
  clientId: string;
  tenantId: string;
  scopes: string[];
  customProtocol?: string | null;
}

export class MicrosoftAuthService {
  private account: AccountInfo | null = null;
  private pca: PublicClientApplication;
  private config: AzureConfig;

  constructor(azureConfig: AzureConfig, pca?: PublicClientApplication) {
    this.config = azureConfig;
    if (pca) {
      this.pca = pca;
    } else {
      const cachePlugin = new MsalSecureCachePlugin();

      this.pca = new PublicClientApplication({
        auth: {
          clientId: azureConfig.clientId,
          authority: `https://login.microsoftonline.com/${azureConfig.tenantId}`,
        },
        cache: { cachePlugin },
        system: {
          loggerOptions: {
            loggerCallback(_loglevel, message, _containsPii) {
              console.log(message);
            },
            piiLoggingEnabled: false,
            logLevel: LogLevel.Info,
          },
        },
      });
    }
  }

  private getScopes(): string[] {
    return this.config.scopes ?? [];
  }

  async isAuthenticated(): Promise<boolean> {
    const authState = await this.getAuthState();
    return authState.status === AuthStatus.AUTHENTICATED;
  }

  async getAuthState(): Promise<AuthState> {
    try {
      const account = await this.getAccount();
      if (!account)
        return {
          status: AuthStatus.NOT_AUTHENTICATED,
        } as AuthState;

      try {
        const tokenRequest: SilentFlowRequest = {
          scopes: this.getScopes(),
          account: account,
        };
        const accountInfo = await this.loginSilent(tokenRequest);
        if (accountInfo) {
          return { status: AuthStatus.AUTHENTICATED, accountInfo } as AuthState;
        } else {
          return { status: AuthStatus.NOT_AUTHENTICATED } as AuthState;
        }
      } catch (e) {
        if (e instanceof InteractionRequiredAuthError) {
          return { status: AuthStatus.NOT_AUTHENTICATED } as AuthState;
        }
        return { status: AuthStatus.ERROR, error: formatErrorMessage(e) } as AuthState;
      }
    } catch (error) {
      return { status: AuthStatus.ERROR, error: formatErrorMessage(error) } as AuthState;
    }
  }

  async login(): Promise<AccountInfo | null> {
    try {
      const authResult = await this.getToken();
      return this.handleResponse(authResult);
    } catch (error) {
      console.error("Login failed:", error);
      return null;
    }
  }

  async logout(): Promise<void> {
    try {
      if (!this.account) {
        return;
      }
      await this.pca.getTokenCache().removeAccount(this.account);
      this.account = null;
    } catch (error) {
      const errorMsg = formatErrorMessage(error);
      console.error("Logout error:", errorMsg);
    }
  }

  async loginSilent(tokenRequest: SilentFlowRequest): Promise<AccountInfo | null> {
    let response: AuthenticationResult;
    if (!this.account) {
      const account = await this.getAccount();
      if (account) {
        tokenRequest.account = account;
        response = await this.getTokenSilent(tokenRequest);
        this.account = response.account;
      }
    }
    return this.account;
  }

  async getToken(): Promise<AuthenticationResult> {
    try {
      const request: SilentFlowRequest = {
        scopes: this.getScopes(),
        account: null as unknown as AccountInfo,
      };

      let authResponse: AuthenticationResult;
      const account = this.account || (await this.getAccount());
      if (account) {
        request.account = account;
        authResponse = await this.getTokenSilent(request);
      } else {
        authResponse = await this.getTokenInteractive(request);
      }
      this.account = authResponse.account;
      return authResponse;
    } catch (error) {
      console.error("Error getting token:", formatErrorMessage(error));
      throw error;
    }
  }

  async getTokenSilent(tokenRequest: SilentFlowRequest): Promise<AuthenticationResult> {
    try {
      return await this.pca.acquireTokenSilent(tokenRequest);
    } catch (_error) {
      console.warn("Silent token acquisition failed, acquiring token using pop up");
      return await this.getTokenInteractive(tokenRequest);
    }
  }

  async getTokenInteractive(tokenRequest: SilentFlowRequest): Promise<AuthenticationResult> {
    try {
      // Determine the correct path for template files based on environment
      let uiDir: string;
      if (app.isPackaged) {
        // In production, templates are in extraResources in the Resources folder
        uiDir = join(process.resourcesPath, "src/ui");
      } else {
        // In development, templates are in src/ui
        uiDir = join(__dirname, "../../../src/ui");
      }

      const successPath = join(uiDir, "successTemplate.html");
      const errorPath = join(uiDir, "errorTemplate.html");

      // Check if files exist
      if (!fs.existsSync(successPath)) {
        console.error(`[Auth Debug] Success template not found at: ${successPath}`);
        throw new Error(`Success template not found: ${successPath}`);
      }
      if (!fs.existsSync(errorPath)) {
        console.error(`[Auth Debug] Error template not found at: ${errorPath}`);
        throw new Error(`Error template not found: ${errorPath}`);
      }

      const successHtml = fs.readFileSync(successPath, "utf8");
      const errorHtml = fs.readFileSync(errorPath, "utf8");
      const openBrowser = async (url: string) => await shell.openExternal(url);
      const interactiveRequest: InteractiveRequest = {
        ...tokenRequest,
        openBrowser,
        successTemplate: successHtml,
        errorTemplate: errorHtml,
        prompt: "select_account", // Force account selection
      };

      const authResponse = await this.pca.acquireTokenInteractive(interactiveRequest);
      return authResponse;
    } catch (error) {
      console.error("Error getting token interactively:", formatErrorMessage(error));
      throw error;
    }
  }

  /**
   * Handles the response from a popup or redirect. If response is null, will check if we have any accounts and attempt to sign in.
   * @param response
   */
  private async handleResponse(response: AuthenticationResult): Promise<AccountInfo | null> {
    this.account = response?.account || (await this.getAccount());
    return this.account;
  }

  public currentAccount(): AccountInfo | null {
    return this.account;
  }

  private async getAccount(): Promise<AccountInfo | null> {
    const cache = this.pca.getTokenCache();
    const currentAccounts = await cache.getAllAccounts();

    if (currentAccounts === null) {
      return null;
    }

    if (currentAccounts.length > 1) {
      return currentAccounts[0];
    } else if (currentAccounts.length === 1) {
      return currentAccounts[0];
    } else {
      return null;
    }
  }
}
