import https from "node:https";
import type { AccountInfo } from "@azure/msal-node";
import { ipcMain } from "electron";
import { config } from "../config/env";
import { MicrosoftAuthService } from "../services/auth/microsoft-auth";
import type { GetMyShavesResponse } from "../types";
import { formatErrorMessage } from "../utils/error-utils";
import { IPC_CHANNELS } from "./channels";

export function registerPortalHandlers() {
  ipcMain.handle(IPC_CHANNELS.PORTAL_GET_MY_SHAVES, async () => {
    try {
      const ms = MicrosoftAuthService.getInstance();
      const tokenRequest = {
        account: null as unknown as AccountInfo,
        scopes: config.azure()?.scopes || [],
      };
      const result = await ms.getToken(tokenRequest);

      // Parse the portal API URL
      const apiUrl = config.portalApi();
      const url = new URL(apiUrl);
      const hostname = url.hostname;
      const port = url.port ? parseInt(url.port, 10) : url.protocol === "https:" ? 443 : 80;
      const path = `${url.pathname.replace(/\/$/, "")}/me/shaves`; // Ensure no double slashes

      // Make API call to get user's shaves using HTTPS module for SSL certificate handling
      const data = await new Promise<GetMyShavesResponse>((resolve, reject) => {
        const options = {
          hostname: hostname,
          port: port,
          path: path,
          method: "GET",
          headers: {
            Authorization: `Bearer ${result.accessToken}`,
            "Content-Type": "application/json",
          },
          rejectUnauthorized: false, // Allow self-signed certificates for development
        };

        const req = https.request(options, (res) => {
          let responseData = "";

          res.on("data", (chunk) => {
            responseData += chunk;
          });

          res.on("end", () => {
            if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
              try {
                const parsedData = JSON.parse(responseData);
                resolve(parsedData);
              } catch (error) {
                reject(new Error(`Failed to parse JSON response: ${formatErrorMessage(error)}`));
              }
            } else {
              reject(new Error(`API call failed: ${res.statusCode} ${res.statusMessage}`));
            }
          });
        });

        req.on("error", (error) => {
          reject(error);
        });

        req.end();
      });

      return { success: true, data };
    } catch (error) {
      console.error("Portal API error:", formatErrorMessage(error));
      return { success: false, error: formatErrorMessage(error) };
    }
  });
}
