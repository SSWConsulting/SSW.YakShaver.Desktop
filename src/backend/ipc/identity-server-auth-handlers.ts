import { ipcMain } from "electron";
import type { IdentityServerAuthService } from "../services/auth/identity-server-auth";
import { formatAndReportError } from "../utils/error-utils";
import { IPC_CHANNELS } from "./channels";

export class IdentityServerAuthIPCHandlers {
  private authService: IdentityServerAuthService;

  constructor(authService: IdentityServerAuthService) {
    this.authService = authService;
    this.registerHandlers();
  }

  private registerHandlers() {
    const handlers = {
      [IPC_CHANNELS.IS_AUTH_LOGIN]: async () => {
        try {
          return await this.authService.login();
        } catch (error) {
          return { success: false, error: formatAndReportError(error, "identity_server_auth") };
        }
      },
      [IPC_CHANNELS.IS_AUTH_LOGOUT]: async () => {
        try {
          return await this.authService.logout();
        } catch (error) {
          return { success: false, error: formatAndReportError(error, "identity_server_auth") };
        }
      },
      [IPC_CHANNELS.IS_AUTH_STATUS]: async () => {
        try {
          return await this.authService.getAuthState();
        } catch (error) {
          return { status: "error", error: formatAndReportError(error, "identity_server_auth") };
        }
      },
      [IPC_CHANNELS.IS_AUTH_ACCOUNT_INFO]: async () => {
        try {
          const state = await this.authService.getAuthState();
          return { success: true, data: state.userInfo };
        } catch (error) {
          return { success: false, error: formatAndReportError(error, "identity_server_auth") };
        }
      },
    } as const;

    Object.entries(handlers).forEach(([channel, handler]) => {
      ipcMain.handle(channel, handler as () => unknown);
    });
  }
}
