// Followed example from Microsoft's Electron sample app
// https://github.com/AzureAD/microsoft-authentication-library-for-js/blob/dev/samples/msal-node-samples/ElectronSystemBrowserTestApp/README.md
import { join } from "node:path";
import { shell, app } from "electron";
import { PublicClientApplication, InteractionRequiredAuthError, LogLevel } from "@azure/msal-node";
import { config } from "../../config/env";
import { formatErrorMessage } from "../../utils/error-utils";
import type { AuthState } from "./types";
import { AuthStatus } from "./types";
import { MsalSecureCachePlugin } from "./msal-cache-plugin";
import "isomorphic-fetch";
import * as fs from "node:fs";
import type { AccountInfo, AuthenticationResult, InteractiveRequest, SilentFlowRequest } from "@azure/msal-node";

export class MicrosoftAuthService {
  private static instance: MicrosoftAuthService;
  private account: AccountInfo | null = null;
  private pca: PublicClientApplication;

  private constructor() {
    const azure = config.azure();
    if (!azure) throw new Error("Azure configuration missing");
    const cachePlugin = new MsalSecureCachePlugin();

    this.pca = new PublicClientApplication({
      auth: {
        clientId: azure.clientId,
        authority: `https://login.microsoftonline.com/${azure.tenantId}`,
      },
      cache: { cachePlugin },
      system: {
        loggerOptions: {
          loggerCallback(loglevel, message, containsPii) {
            console.log(message);
          },
          piiLoggingEnabled: false,
          logLevel: LogLevel.Info,
        },
      },
    });
  }

  static getInstance(): MicrosoftAuthService {
    if (!MicrosoftAuthService.instance) {
      MicrosoftAuthService.instance = new MicrosoftAuthService();
    }
    return MicrosoftAuthService.instance;
  }

  private getScopes(): string[] {
    return config.azure()?.scopes ?? [];
  }

  async isAuthenticated(): Promise<boolean> {
    const authState = await this.getAuthState();
    return authState.status === AuthStatus.AUTHENTICATED;
  }

  async getAuthState(): Promise<AuthState> {
    try {
      const account = await this.getAccount();
      if (!account) return {
        status: AuthStatus.NOT_AUTHENTICATED 
      } as AuthState;

      try {
        const tokenRequest: SilentFlowRequest = {
          scopes: this.getScopes(),
          account: account
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
      const tokenRequest: SilentFlowRequest = {
        scopes: this.getScopes(),
        account: null as any,
      };
      const authResult = await this.getToken(tokenRequest);
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
    let response;
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

  async getToken(
    tokenRequest: SilentFlowRequest
  ): Promise<AuthenticationResult> {
    try {
      let authResponse: AuthenticationResult;
      const account = this.account || (await this.getAccount());
      if (account) {
        tokenRequest.account = account;
        authResponse = await this.getTokenSilent(tokenRequest);
      } else {
        authResponse = await this.getTokenInteractive(tokenRequest);
      }
      this.account = authResponse.account;
      return authResponse;
    } catch (error) {
      throw error;
    }
  }

  async getTokenSilent(
    tokenRequest: SilentFlowRequest
  ): Promise<AuthenticationResult> {
    try {
      return await this.pca.acquireTokenSilent(
        tokenRequest
      );
    } catch (error) {
      console.warn(
        "Silent token acquisition failed, acquiring token using pop up"
      );
      return await this.getTokenInteractive(tokenRequest);
    }
  }

  async getTokenInteractive(tokenRequest: SilentFlowRequest): Promise<AuthenticationResult> {
    try {
      const azure = config.azure();
      
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

      const successHtmlRaw = fs.readFileSync(successPath, "utf8");
      const errorHtmlRaw = fs.readFileSync(errorPath, "utf8");
      const protocol = azure?.customProtocol || `msal${azure!.clientId}`;
      const successHtml = successHtmlRaw.replace(/msal\{Your_Application\/Client_Id\}/g, protocol).replace(/msal\{Your_Application\/Client_Id\}:\/\/auth/g, `${protocol}://auth`);
      const errorHtml = errorHtmlRaw;

      const openBrowser = async (url: any) => await shell.openExternal(url);
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
