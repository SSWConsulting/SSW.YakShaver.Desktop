import { ipcMain } from "electron";
import type { MicrosoftAuthService } from "../services/auth/microsoft-auth";
import { formatErrorMessage } from "../utils/error-utils";
import { IPC_CHANNELS } from "./channels";

export class MicrosoftAuthIPCHandlers {
  private microsoftAuthService: MicrosoftAuthService;

  constructor(microsoftAuthService: MicrosoftAuthService) {
    this.microsoftAuthService = microsoftAuthService;
    this.registerHandlers();
  }

  private registerHandlers() {
    const handlers = {
      [IPC_CHANNELS.MS_AUTH_LOGIN]: async () => {
        try {
          const result = await this.microsoftAuthService.login();
          if (result) {
            return { success: true };
          } else {
            return { success: false, error: "Authentication failed" };
          }
        } catch (error) {
          return { success: false, error: formatErrorMessage(error) };
        }
      },
      [IPC_CHANNELS.MS_AUTH_LOGOUT]: async () => {
        try {
          return await this.microsoftAuthService.logout();
        } catch (error) {
          return { success: false, error: formatErrorMessage(error) };
        }
      },
      [IPC_CHANNELS.MS_AUTH_STATUS]: async () => {
        try {
          return await this.microsoftAuthService.getAuthState();
        } catch (error) {
          return { status: "error", error: formatErrorMessage(error) };
        }
      },
      [IPC_CHANNELS.MS_AUTH_ACCOUNT_INFO]: async () => {
        try {
          const accountInfo = this.microsoftAuthService.currentAccount();
          return { success: true, data: accountInfo };
        } catch (error) {
          return { success: false, error: formatErrorMessage(error) };
        }
      },
    } as const;

    Object.entries(handlers).forEach(([channel, handler]) => {
      ipcMain.handle(channel, handler as () => unknown);
    });
  }
}
