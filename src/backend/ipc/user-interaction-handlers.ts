import { ipcMain } from "electron";
import type { InteractionResponse } from "../../shared/types/user-interaction";
import { UserInteractionService } from "../services/user-interaction/user-interaction-service";
import { IPC_CHANNELS } from "./channels";

export function registerUserInteractionHandlers(): void {
  const service = UserInteractionService.getInstance();

  ipcMain.handle(
    IPC_CHANNELS.USER_INTERACTION_RESPONSE,
    async (_, response: InteractionResponse) => {
      const { requestId, data } = response;
      return service.resolveInteraction(requestId, data);
    },
  );

  ipcMain.handle(IPC_CHANNELS.SHAVE_SET_AUTO_APPROVE, async (_, value: boolean) => {
    service.setShaveAutoApprove(value);
    return { success: true };
  });
}
