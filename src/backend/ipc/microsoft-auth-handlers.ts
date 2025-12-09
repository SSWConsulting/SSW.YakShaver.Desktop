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
          return await ms.login();
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
      [IPC_CHANNELS.MS_GRAPH_GET_ME]: async () => {
        try {
          const ms = MicrosoftAuthService.getInstance();
          const token = await ms.getAccessToken();
          const info = await (await import("@microsoft/microsoft-graph-client")).Client
            .init({ authProvider: (done) => done(null, token) })
            .api("/me")
            .get();
          return { success: true, data: info };
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
