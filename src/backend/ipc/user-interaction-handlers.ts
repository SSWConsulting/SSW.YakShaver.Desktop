import { ipcMain } from "electron";
import { IPC_CHANNELS } from "./channels";
import { UserInteractionService } from "../services/user-interaction/user-interaction-service";
import type { InteractionResponse } from "../../shared/types/user-interaction";

export function registerUserInteractionHandlers(): void {
  const service = UserInteractionService.getInstance();

  ipcMain.handle(
    IPC_CHANNELS.USER_INTERACTION_RESPONSE,
    async (_, response: InteractionResponse) => {
      const { requestId, data } = response;
      return service.resolveInteraction(requestId, data);
    },
  );
}
