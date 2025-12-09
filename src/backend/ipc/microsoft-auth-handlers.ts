import { ipcMain } from "electron";
import { IPC_CHANNELS } from "./channels";
import { MicrosoftAuthService } from "../services/auth/microsoft-auth";
import { formatErrorMessage } from "../utils/error-utils";

export class MicrosoftAuthIPCHandlers {

  constructor() {
    this.registerHandlers();
  }

  private registerHandlers() {
    const handlers = {
      [IPC_CHANNELS.MS_AUTH_LOGIN]: async () => {
        try {
          const ms = MicrosoftAuthService.getInstance();
          const result = await ms.login();
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
          const ms = MicrosoftAuthService.getInstance();
          return await ms.logout();
        } catch (error) {
          return false;
        }
      },
      [IPC_CHANNELS.MS_AUTH_STATUS]: async () => {
        try {
          const ms = MicrosoftAuthService.getInstance();
          return await ms.getAuthState();
        } catch (error) {
          return { status: "error", error: formatErrorMessage(error) } as any;
        }
      },
      [IPC_CHANNELS.MS_AUTH_ACCOUNT_INFO]: async () => {
        try {
          const ms = MicrosoftAuthService.getInstance();
          const accountInfo = ms.currentAccount();
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
