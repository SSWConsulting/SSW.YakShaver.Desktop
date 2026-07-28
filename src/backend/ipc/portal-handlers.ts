import type { GetMyProjectsResponse } from "@shared/types/portal";
import { ipcMain } from "electron";
import { config } from "../config/env";
import type { IdentityServerAuthService } from "../services/auth/identity-server-auth";
import { fetchProjectSummaries, mapProjectsResponse } from "../services/portal/portal-projects";
import { formatAndReportError } from "../utils/error-utils";
import { IPC_CHANNELS } from "./channels";

export function registerPortalHandlers(identityServerAuthService: IdentityServerAuthService) {
  // #816: list the signed-in user's projects, sourced from the portal endpoint
  // GET {portalApiUrl}/projects/summaries — the same project list the remote-prompts feature
  // already consumes in production. NOTE: that endpoint is tenant/organisation-scoped (every
  // active project in the caller's org), NOT membership-scoped, so this is "projects in your
  // organisation" pending the user-scoped endpoint tracked in SSWConsulting/SSW.YakShaver#3775;
  // when that lands, repoint PROJECT_SUMMARIES_PATH and this becomes a true memberships list.
  // The fetch + DTO + mapping live in the shared portal-projects service so the endpoint
  // contract has a single owner (AGENTS.md Rule 7/10). Returns a structured `code` for the
  // signed-out case so the UI branches on a discriminator rather than parsing the error prose.
  ipcMain.handle(IPC_CHANNELS.PORTAL_GET_MY_PROJECTS, async () => {
    try {
      const accessToken = await identityServerAuthService.getAccessToken();
      if (!accessToken) {
        return { success: false, code: "NOT_SIGNED_IN", error: "Not signed in" } as const;
      }

      const parsed = await fetchProjectSummaries(accessToken);
      const items = mapProjectsResponse(parsed);
      if (items === null) {
        // 2xx but an unrecognised body — surface an error rather than a misleading
        // "you're not a member of any projects" empty state.
        throw new Error("Unexpected projects response shape");
      }

      const data: GetMyProjectsResponse = { items };
      return { success: true, data } as const;
    } catch (error) {
      console.error("Portal API error:", formatAndReportError(error, "portal_api"));
      return {
        success: false,
        code: "REQUEST_FAILED",
        error: formatAndReportError(error, "portal_api"),
      } as const;
    }
  });

  ipcMain.handle(IPC_CHANNELS.PORTAL_CANCEL_WORK_ITEM, async (_event, workItemId?: string) => {
    if (!workItemId) {
      return { success: false, error: "Work item id is required" };
    }

    try {
      const accessToken = await identityServerAuthService.getAccessToken();
      if (!accessToken) {
        return { success: false, error: "Failed to obtain access token" };
      }

      const apiUrl = config.portalApiUrl();
      const portalApiUrl = new URL(apiUrl);
      const requestUrl = new URL(portalApiUrl.origin);
      requestUrl.pathname = `${portalApiUrl.pathname.replace(/\/$/, "")}/desktopapp/work-items/${workItemId}:cancel`;

      const response = await fetch(requestUrl.toString(), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.warn("Portal API error:", errorText);
        return { success: false, error: errorText || response.statusText } as const;
      }

      return { success: true } as const;
    } catch (error) {
      console.error("Portal API error:", formatAndReportError(error, "portal_api"));
      return { success: false, error: formatAndReportError(error, "portal_api") } as const;
    }
  });
}
