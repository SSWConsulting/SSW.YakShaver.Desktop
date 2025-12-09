import { join } from "node:path";
import { shell, app } from "electron";
import { PublicClientApplication, InteractionRequiredAuthError } from "@azure/msal-node";
import { config } from "../../config/env";
import { formatErrorMessage } from "../../utils/error-utils";
import type { AuthResult, AuthState, UserInfo } from "./types";
import { AuthStatus } from "./types";
import { MsalSecureCachePlugin } from "./msal-cache-plugin";
import { Client } from "@microsoft/microsoft-graph-client";
import "isomorphic-fetch";
import * as fs from "node:fs";
import type { InteractiveRequest } from "@azure/msal-node";
import { CustomLoopbackClient } from "./msal-loopback-client";

const DEFAULT_SCOPES = ["User.Read"];

export class MicrosoftAuthService {
  private static instance: MicrosoftAuthService;
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
    });
  }

  static getInstance(): MicrosoftAuthService {
    if (!MicrosoftAuthService.instance) {
      MicrosoftAuthService.instance = new MicrosoftAuthService();
    }
    return MicrosoftAuthService.instance;
  }

  private getScopes(): string[] {
    return config.azure()?.scopes ?? DEFAULT_SCOPES;
  }

  async isAuthenticated(): Promise<boolean> {
    const accounts = await this.pca.getTokenCache().getAllAccounts();
    if (!accounts.length) return false;
    try {
      await this.pca.acquireTokenSilent({ account: accounts[0], scopes: this.getScopes() });
      return true;
    } catch {
      return false;
    }
  }

  async login(): Promise<AuthResult> {
    try {
      const scopes = this.getScopes();
      const azure = config.azure();
      const uiDir = app.isPackaged ? process.resourcesPath : join(__dirname, "../../../src/ui");
      const successPath = join(uiDir, "successTemplate.html");
      const errorPath = join(uiDir, "errorTemplate.html");
      
      // Check if files exist
      if (!fs.existsSync(successPath)) {
        throw new Error(`Success template not found: ${successPath}`);
      }
      if (!fs.existsSync(errorPath)) {
        throw new Error(`Error template not found: ${errorPath}`);
      }
      
      const successHtmlRaw = fs.readFileSync(successPath, "utf8");
      const errorHtmlRaw = fs.readFileSync(errorPath, "utf8");
      
      const protocol = azure?.customProtocol || `msal${azure!.clientId}`;
      
      const successHtml = successHtmlRaw.replace(/msal\{Your_Application\/Client_Id\}/g, protocol).replace(/msal\{Your_Application\/Client_Id\}:\/\/auth/g, `${protocol}://auth`);
      const errorHtml = errorHtmlRaw;

      const loopbackClient = await CustomLoopbackClient.initialize(3874);
      
      const interactiveRequest: InteractiveRequest = {
        scopes,
        openBrowser: (url) => shell.openExternal(url),
        successTemplate: successHtml,
        errorTemplate: errorHtml,
        loopbackClient,
        prompt: "select_account", // Force account selection
      };

      const result = await this.pca.acquireTokenInteractive(interactiveRequest);

      const userInfo = await this.getCurrentUserInfo(result.accessToken);
      return { success: true, userInfo };
    } catch (error) {
      const code = (error as any)?.errorCode || (error as any)?.code;
      const message =
        code === "user_cancelled" || code === "authentication_canceled"
          ? "Authentication cancelled by user"
          : code === "no_network_connection"
          ? "Network unavailable"
          : formatErrorMessage(error);
      return { success: false, error: message };
    }
  }

  async logout(): Promise<boolean> {
    try {
      const accounts = await this.pca.getTokenCache().getAllAccounts();
      for (const a of accounts) await this.pca.getTokenCache().removeAccount(a);
      return true;
    } catch {
      return false;
    }
  }

  async getAuthState(): Promise<AuthState> {
    try {
      const accounts = await this.pca.getTokenCache().getAllAccounts();
      if (!accounts.length) return { status: AuthStatus.NOT_AUTHENTICATED } as AuthState;
      const scopes = this.getScopes();
      try {
        const res = await this.pca.acquireTokenSilent({ account: accounts[0], scopes });
        const userInfo = await this.getCurrentUserInfo(res.accessToken);
        return { status: AuthStatus.AUTHENTICATED, userInfo } as AuthState;
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

  async getAccessToken(): Promise<string> {
    const accounts = await this.pca.getTokenCache().getAllAccounts();
    const scopes = this.getScopes();
    try {
      const silent = accounts.length
        ? await this.pca.acquireTokenSilent({ account: accounts[0], scopes })
        : null;
      if (silent?.accessToken) return silent.accessToken;
      const azure = config.azure();
      const uiDir = app.isPackaged ? process.resourcesPath : join(__dirname, "../../../src/ui");
      const successPath = join(uiDir, "successTemplate.html");
      const errorPath = join(uiDir, "errorTemplate.html");
      
      if (!fs.existsSync(successPath)) {
        throw new Error(`Success template not found: ${successPath}`);
      }
      
      const successHtmlRaw = fs.readFileSync(successPath, "utf8");
      const errorHtmlRaw = fs.readFileSync(errorPath, "utf8");
      
      const protocol = azure?.customProtocol || `msal${azure!.clientId}`;
      
      const successHtml = successHtmlRaw.replace(/msal\{Your_Application\/Client_Id\}/g, protocol).replace(/msal\{Your_Application\/Client_Id\}:\/\/auth/g, `${protocol}://auth`);
      const errorHtml = errorHtmlRaw;

      const loopbackClient = await CustomLoopbackClient.initialize(3874);
      const interactiveRequest: InteractiveRequest = {
        scopes,
        openBrowser: (url) => shell.openExternal(url),
        successTemplate: successHtml,
        errorTemplate: errorHtml,
        loopbackClient,
        prompt: "select_account", // Force account selection
      };
      const interactive = await this.pca.acquireTokenInteractive(interactiveRequest);
      return interactive.accessToken;
    } catch (error) {
      const code = (error as any)?.errorCode || (error as any)?.code;
      if (code === "no_network_connection") {
        throw new Error("Network unavailable");
      }
      throw error;
    }
  }

  private async getCurrentUserInfo(accessToken: string): Promise<UserInfo> {
    const client = Client.init({ authProvider: (done) => done(null, accessToken) });
    const me = await client.api("/me").get();
    return {
      id: me.id || "",
      name: me.displayName || me.userPrincipalName || "",
      email: me.mail || me.userPrincipalName || "",
    };
  }
}
